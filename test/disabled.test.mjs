import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDisableFlag, setDisableFlag } from '../src/frontmatter.mjs'
import { buildCatalog } from '../src/catalog.mjs'
import { layout } from '../src/store/paths.mjs'
import { createCollector } from '../src/collector.mjs'
import { createDshAdapter } from '../src/adapters/dsh.mjs'
import { createHealthService } from '../src/health-service.mjs'
import { DEFAULT_CONFIG } from '../src/store/paths.mjs'

function agedSkill(name, days, overrides = {}) {
  return {
    name,
    description: `A unique capability for ${name}`,
    category: 'user',
    source: 'user-agents',
    path: `/skills/${name}/SKILL.md`,
    install_path: `/skills/${name}`,
    exists: true,
    editable: true,
    disabled: false,
    model_invocable: true,
    missing: [],
    installed_at: new Date(Date.now() - days * 86_400_000).toISOString(),
    tokens_est: 100,
    ...overrides,
  }
}

test('the standard disable-model-invocation field round-trips without touching other lines', () => {
  const root = mkdtempSync(join(tmpdir(), 'skilltrace-frontmatter-'))
  try {
    const file = join(root, 'SKILL.md')
    writeFileSync(file, '---\nname: demo\ndescription: Demo skill\n---\n\n# Body\n', 'utf8')
    assert.equal(readDisableFlag(file), false)

    setDisableFlag(file, true)
    assert.equal(readDisableFlag(file), true)
    assert.match(readFileSync(file, 'utf8'), /disable-model-invocation: true/)
    assert.match(readFileSync(file, 'utf8'), /description: Demo skill/)
    assert.match(readFileSync(file, 'utf8'), /# Body/)

    setDisableFlag(file, false)
    assert.equal(readDisableFlag(file), false)
    assert.match(readFileSync(file, 'utf8'), /disable-model-invocation: false/)

    writeFileSync(file, '---\r\nname: crlf\r\ndescription: CRLF skill\r\n---\r\n\r\nBody\r\n', 'utf8')
    setDisableFlag(file, true)
    assert.match(readFileSync(file, 'utf8'), /\r\n/)
    assert.equal(readDisableFlag(file), true)

    writeFileSync(file, 'no frontmatter\n', 'utf8')
    assert.throws(() => setDisableFlag(file, true), /frontmatter/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('catalog reads the file flag even when the provider summary is stale', () => {
  const root = mkdtempSync(join(tmpdir(), 'skilltrace-catalog-flag-'))
  try {
    const file = join(root, 'SKILL.md')
    writeFileSync(file, '---\nname: demo\ndescription: Demo\n---\nBody\n', 'utf8')
    const summary = {
      name: 'demo',
      description: 'Demo',
      path: file,
      source: 'user-agents',
      invocation: { modelInvocable: true, userInvocable: true },
    }
    let catalog = buildCatalog([summary])
    assert.equal(catalog[0].disabled, false)
    assert.equal(catalog[0].editable, true)

    setDisableFlag(file, true)
    // The provider summary still says modelInvocable: true, but the page must
    // follow the file after a refresh.
    catalog = buildCatalog([summary])
    assert.equal(catalog[0].disabled, true)
    assert.equal(catalog[0].file_disabled, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('disabled skills do not lower health and are omitted from suggestions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'skilltrace-health-disabled-'))
  const paths = layout(root)
  const config = {
    collect: { ...DEFAULT_CONFIG.collect },
    health: { ...DEFAULT_CONFIG.health, duplicate_similarity: 1.1 },
    notify: { ...DEFAULT_CONFIG.notify },
  }
  const skills = [
    agedSkill('keep-1', 45),
    agedSkill('keep-2', 45),
    agedSkill('hidden', 60, { disabled: true, model_invocable: false }),
  ]
  const collector = createCollector({ root, host: 'dsh', adapter: createDshAdapter(), config })
  const service = createHealthService({
    paths,
    host: 'dsh',
    config,
    collector,
    catalog: async () => skills,
    logger: () => {},
  })
  try {
    const state = await service.getState({ sessionId: 's' })
    assert.equal(state.totals.skills, 2)
    assert.equal(state.issues.length, 2)
    assert.deepEqual(state.disabledSkills, ['hidden'])
    assert.ok(state.suggestions.every((item) => item.skill !== 'hidden'))
    assert.equal(state.score, 40)

    const manage = await service.manage()
    assert.equal(manage.skills.find((skill) => skill.name === 'hidden').enabled, false)
    assert.equal(manage.skills.find((skill) => skill.name === 'hidden').editable, true)
    assert.equal(manage.skills.find((skill) => skill.name === 'keep-1').enabled, true)
    assert.equal(manage.disabledSkills.length, 1)

    const refreshed = await service.act({ action: 'refresh', sessionId: 's' })
    assert.equal(refreshed.ok, true)
  } finally {
    collector.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})
