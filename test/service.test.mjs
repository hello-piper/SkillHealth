import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCollector } from '../src/collector.mjs'
import { createDshAdapter } from '../src/adapters/dsh.mjs'
import { createHealthService } from '../src/health-service.mjs'
import { layout, DEFAULT_CONFIG } from '../src/store/paths.mjs'

const TOPICS = [
  'quarterly finance reports', 'isometric diagrams', 'release notes', 'browser automation',
  'database migrations', 'incident retrospectives', 'API contracts', 'accessibility audits',
  'image optimisation', 'log analysis', 'translation memory', 'unit test scaffolding',
  'dependency upgrades', 'security reviews', 'onboarding guides', 'data visualisation',
  'email templates', 'meeting summaries', 'benchmark harnesses', 'feature flags',
]

function agedSkill(name, days, topic) {
  return {
    name,
    description: `Maintain ${topic}`,
    category: 'user',
    source: 'user-agents',
    path: `/skills/${name}/SKILL.md`,
    install_path: `/skills/${name}`,
    exists: true,
    missing: [],
    installed_at: new Date(Date.now() - days * 86_400_000).toISOString(),
    tokens_est: 100,
  }
}

test('health service scans, gates the reminder, and honours close/ignore', async () => {
  const root = mkdtempSync(join(tmpdir(), 'skilltrace-service-'))
  const paths = layout(root)
  const config = {
    collect: { ...DEFAULT_CONFIG.collect },
    health: { ...DEFAULT_CONFIG.health },
    notify: { ...DEFAULT_CONFIG.notify },
  }
  const collector = createCollector({ root, host: 'dsh', adapter: createDshAdapter({ agentVersion: '0.2.1' }), config })
  const skills = TOPICS.map((topic, index) => agedSkill(`skill-${index}`, 45, topic))
  const service = createHealthService({
    paths,
    host: 'dsh',
    config,
    collector,
    catalog: async () => skills,
    logger: () => {},
  })

  try {
    const state = await service.getState({ sessionId: 'session-1' })
    assert.equal(state.score, 40)
    assert.equal(state.issues.length, 20)
    assert.ok(state.reminder, 'a low score must produce a reminder')
    assert.equal(state.reminder.banner.skills, 20)
    assert.match(state.reminder.terminal, /SkillHealth/)
    assert.ok(state.weekly.text.length > 0)

    const line = await service.remindTerminal('session-1')
    assert.match(line, /20 个技能待整理/)
    assert.equal(await service.remindTerminal('session-1'), null, 'one reminder per session')

    const closed = await service.act({ action: 'close', rule: 'never_used', sessionId: 'session-1' })
    assert.equal(closed.ok, true)
    assert.equal(closed.state.reminder, null)
    assert.deepEqual(closed.state.disabledRules, ['never_used'])

    const ignored = await service.act({ action: 'ignore', sessionId: 'session-1' })
    assert.equal(ignored.ok, true)
    assert.ok(ignored.state.silencedUntil)
    assert.equal(ignored.state.reminder, null)

    const reset = await service.act({ action: 'reset', sessionId: 'session-1' })
    assert.equal(reset.ok, true)
    assert.equal(reset.state.silencedUntil, null)
    assert.ok(reset.state.reminder, 'reset restores the reminder')
  } finally {
    collector.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})
