import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeHealth, reminderDue } from '../src/core/health.mjs'
import { formatReminder } from '../src/core/notify.mjs'

const NOW = Date.parse('2026-10-27T09:00:00.000Z')
const daysAgo = (days) => new Date(NOW - days * 86_400_000).toISOString()

function skill(name, description, overrides = {}) {
  return {
    name,
    description,
    category: 'user',
    source: 'user-agents',
    path: `/skills/${name}/SKILL.md`,
    install_path: `/skills/${name}`,
    exists: true,
    missing: [],
    installed_at: daysAgo(90),
    tokens_est: 120,
    ...overrides,
  }
}

function call(skillName, status, startedAt, duration) {
  return {
    skill: skillName,
    status,
    started_at: startedAt,
    ended_at: startedAt,
    duration_ms: duration,
  }
}

function fixture() {
  const skills = [
    skill('never-used', 'Generate quarterly finance summaries', { installed_at: daysAgo(40) }),
    skill('stale', 'Rotate deployment credentials', { installed_at: daysAgo(200) }),
    skill('dup-a', 'Render interactive isometric diagrams as SVG', { category: 'project' }),
    skill('dup-b', 'Render interactive isometric diagrams as SVG', { category: 'project' }),
    skill('broken', 'Publish release notes', { exists: false }),
    skill('flaky', 'Run browser automation against staging', { installed_at: daysAgo(20) }),
    skill('conflict-a', 'Deploy frontend assets safely', { category: 'project' }),
    skill('conflict-b', 'Deploy frontend assets reliably', { category: 'user' }),
    skill('healthy', 'Write test driven code', { category: 'project' }),
  ]
  const calls = [
    call('stale', 'ok', daysAgo(70), 900),
    call('stale', 'ok', daysAgo(80), 800),
    call('dup-a', 'ok', daysAgo(2), 1200),
    call('dup-b', 'ok', daysAgo(2), 1100),
    call('healthy', 'ok', daysAgo(1), 600),
    call('healthy', 'ok', daysAgo(2), 700),
    call('healthy', 'ok', daysAgo(3), 800),
    call('healthy', 'ok', daysAgo(4), 900),
    call('healthy', 'ok', daysAgo(5), 1000),
  ]
  for (let index = 0; index < 12; index += 1) {
    calls.push(call('flaky', index < 4 ? 'error' : 'ok', daysAgo(1), 2000))
  }
  const cooccur = []
  for (let index = 0; index < 3; index += 1) {
    cooccur.push({ session_id: `s-${index}`, skill_a: 'conflict-a', skill_b: 'conflict-b' })
  }
  return { skills, calls, cooccur }
}

test('all six rules produce issues and a bounded score', () => {
  const { skills, calls, cooccur } = fixture()
  const health = analyzeHealth({ skills, calls, cooccur, config: {}, now: NOW })

  assert.ok(health.byRule.never_used >= 1)
  assert.ok(health.byRule.stale >= 1)
  assert.ok(health.byRule.duplicate >= 2)
  assert.equal(health.byRule.missing_path, 1)
  assert.equal(health.byRule.high_failure, 1)
  assert.equal(health.byRule.trigger_conflict, 2)

  for (const value of Object.values(health.dimensions)) {
    assert.ok(value >= 0 && value <= 100)
  }
  assert.ok(health.score >= 0 && health.score <= 100)
  assert.ok(health.tokensWasted > 0)
  assert.ok(health.archiveSkills.includes('never-used'))
  assert.ok(health.archiveSkills.includes('stale'))
})

test('duplicate detection respects the category boundary', () => {
  const { skills } = fixture()
  const health = analyzeHealth({ skills, calls: [], cooccur: [], config: {}, now: NOW })
  const duplicates = health.issues.filter((issue) => issue.rule === 'duplicate').map((issue) => issue.skill)
  assert.deepEqual(duplicates.sort(), ['dup-a', 'dup-b'])
  assert.ok(!duplicates.includes('conflict-a'))
})

test('reminder gate: score, recovery, silence, and closed rule classes', () => {
  const issues = [
    { rule: 'never_used', skill: 'a' },
    { rule: 'duplicate', skill: 'b' },
  ]
  const health = { score: 72, issues }
  assert.equal(reminderDue(health, {}, {}, NOW), true)
  assert.equal(reminderDue({ score: 82, issues }, {}, {}, NOW), false)
  assert.equal(reminderDue(health, {}, { silencedUntil: new Date(NOW + 86_400_000).toISOString() }, NOW), false)
  assert.equal(reminderDue(health, {}, { disabledRules: ['never_used', 'duplicate'] }, NOW), false)
  assert.equal(reminderDue({ score: 90, issues: new Array(20).fill(issues[0]) }, {}, {}, NOW), false)
})

test('one reminder copy feeds all three channels', () => {
  const message = formatReminder({
    score: 72,
    issues: [
      { rule: 'never_used', skill: 'a' },
      { rule: 'never_used', skill: 'b' },
      { rule: 'duplicate', skill: 'c' },
    ],
    byRule: { never_used: 2, duplicate: 1 },
    archiveSkills: ['a', 'b'],
    tokensWasted: 4800,
  })
  assert.match(message.terminal, /SkillHealth/)
  assert.match(message.terminal, /2 未用 \/ 1 重复/)
  assert.match(message.terminal, /4\.8k tokens/)
  assert.match(message.terminal, /\/skillhealth/)
  assert.match(message.notification.title, /技能库/)
  assert.match(message.notification.subtitle, /健康分 72/)
  assert.match(message.banner.detail, /2 条规则命中 3 个技能/)
})
