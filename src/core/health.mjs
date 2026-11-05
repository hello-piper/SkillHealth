/**
 * Health diagnostics: six rules, four weighted dimensions, one score.
 *
 * 使用覆盖 35% + 成功率 25% + 新鲜度 25% + 冗余控制 15%.
 */
import { descriptionSimilarity, keywordOverlap } from './similarity.mjs'

export const RULES = Object.freeze({
  never_used: { action: 'archive', severity: 'medium' },
  stale: { action: 'archive', severity: 'medium' },
  duplicate: { action: 'merge', severity: 'high' },
  missing_path: { action: 'fix', severity: 'high' },
  high_failure: { action: 'investigate', severity: 'high' },
  trigger_conflict: { action: 'rewrite', severity: 'low' },
})

const DAY = 86_400_000

function daysBetween(from, to) {
  if (!from) return null
  const value = Date.parse(from)
  if (Number.isNaN(value)) return null
  return Math.floor((to - value) / DAY)
}

export function analyzeHealth({ skills = [], calls = [], cooccur = [], config = {}, now = Date.now() }) {
  const healthConfig = {
    unused_days: 30,
    stale_days: 60,
    stale_max_calls: 3,
    fresh_days: 30,
    duplicate_similarity: 0.8,
    failure_min_calls: 10,
    failure_rate: 0.15,
    conflict_cooccurrence: 3,
    conflict_overlap: 0.6,
    ...config,
  }
  const time = now instanceof Date ? now.getTime() : Number(now)

  const stats = new Map()
  for (const call of calls) {
    if (!['ok', 'error', 'abort'].includes(call.status)) continue
    if (!stats.has(call.skill)) {
      stats.set(call.skill, { calls: 0, ok: 0, error: 0, abort: 0, last_used_at: null })
    }
    const row = stats.get(call.skill)
    row.calls += 1
    row[call.status] += 1
    const usedAt = call.ended_at ?? call.started_at
    if (!row.last_used_at || Date.parse(usedAt) > Date.parse(row.last_used_at)) row.last_used_at = usedAt
  }

  const issues = []
  const duplicateSkills = new Set()
  const duplicatePairs = new Set()

  // Rule 3: description similarity within one category. Keep only each
  // skill's best match so a cluster of near-identical descriptions yields one
  // advice row per skill instead of one per pair.
  const bestDuplicate = new Map()
  for (let i = 0; i < skills.length; i += 1) {
    for (let j = i + 1; j < skills.length; j += 1) {
      const left = skills[i]
      const right = skills[j]
      if ((left.category ?? '') !== (right.category ?? '')) continue
      const similarity = descriptionSimilarity(left.description, right.description)
      if (similarity < healthConfig.duplicate_similarity) continue
      duplicatePairs.add(`${left.name}\u0000${right.name}`)
      duplicatePairs.add(`${right.name}\u0000${left.name}`)
      for (const [self, peer] of [[left, right], [right, left]]) {
        const current = bestDuplicate.get(self.name)
        if (!current || similarity > current.similarity) {
          bestDuplicate.set(self.name, { peer: peer.name, similarity })
        }
      }
    }
  }
  for (const [skill, match] of bestDuplicate) {
    duplicateSkills.add(skill)
    issues.push(makeIssue('duplicate', skill, { peer: match.peer, similarity: round(match.similarity, 2) }))
  }

  // Rule 6: keyword overlap plus repeated same-session co-occurrence.
  const cooccurrence = new Map()
  for (const row of cooccur) {
    const key = `${row.skill_a}\u0000${row.skill_b}`
    cooccurrence.set(key, (cooccurrence.get(key) ?? 0) + 1)
  }
  const byName = new Map(skills.map((skill) => [skill.name, skill]))
  for (const [key, count] of cooccurrence) {
    if (count < healthConfig.conflict_cooccurrence) continue
    const [a, b] = key.split('\u0000')
    if (duplicatePairs.has(key)) continue
    const left = byName.get(a)
    const right = byName.get(b)
    if (!left || !right) continue
    const overlap = keywordOverlap(left.description, right.description)
    if (overlap < healthConfig.conflict_overlap) continue
    issues.push(makeIssue('trigger_conflict', a, { peer: b, overlap: round(overlap, 2), count }))
    issues.push(makeIssue('trigger_conflict', b, { peer: a, overlap: round(overlap, 2), count }))
  }

  for (const skill of skills) {
    const row = stats.get(skill.name)
    const callCount = row?.calls ?? 0
    const age = daysBetween(skill.installed_at, time)
    const idle = daysBetween(row?.last_used_at, time)

    // Rule 1: installed > 30 days and never used.
    if (callCount === 0 && age !== null && age > healthConfig.unused_days) {
      issues.push(makeIssue('never_used', skill.name, { days: age }))
    }
    // Rule 2: last use > 60 days and fewer than 3 calls.
    if (callCount > 0 && idle !== null && idle > healthConfig.stale_days && callCount < healthConfig.stale_max_calls) {
      issues.push(makeIssue('stale', skill.name, { days: idle, calls: callCount }))
    }
    // Rule 4: the SKILL.md path or a referenced dependency is missing.
    if (skill.exists === false) {
      issues.push(makeIssue('missing_path', skill.name, { path: skill.path ?? null, missing: skill.missing ?? [] }))
    }
    // Rule 5: at least 10 calls and a failure rate above 15%.
    if (callCount >= healthConfig.failure_min_calls) {
      const rate = (row?.error ?? 0) / callCount
      if (rate > healthConfig.failure_rate) {
        issues.push(makeIssue('high_failure', skill.name, { calls: callCount, rate: round(rate, 2) }))
      }
    }
  }

  const total = skills.length
  const used = [...stats.keys()].filter((name) => (stats.get(name)?.calls ?? 0) > 0)
  const allCalls = [...stats.values()].reduce((sum, row) => sum + row.calls, 0)
  const allOk = [...stats.values()].reduce((sum, row) => sum + row.ok, 0)
  const fresh = skills.filter((skill) => {
    const idle = daysBetween(stats.get(skill.name)?.last_used_at, time)
    return idle !== null && idle <= healthConfig.fresh_days
  })

  const usageScore = total === 0 ? 100 : Math.round((used.length / total) * 100)
  const successScore = allCalls === 0 ? 100 : Math.round((allOk / allCalls) * 100)
  const freshnessScore = total === 0 ? 100 : Math.round((fresh.length / total) * 100)
  const redundancyScore = total === 0
    ? 100
    : Math.round(100 - Math.min(100, (duplicateSkills.size / total) * 100 * 1.5))

  const score = Math.round(
    usageScore * 0.35 + successScore * 0.25 + freshnessScore * 0.25 + redundancyScore * 0.15,
  )

  const byRule = {}
  for (const issue of issues) byRule[issue.rule] = (byRule[issue.rule] ?? 0) + 1

  const archiveSkills = new Set(
    issues.filter((issue) => issue.rule === 'never_used' || issue.rule === 'stale').map((issue) => issue.skill),
  )
  const wasted = new Set([...archiveSkills, ...duplicateSkills])
  const tokensWasted = skills
    .filter((skill) => wasted.has(skill.name))
    .reduce((sum, skill) => sum + (skill.tokens_est ?? 0), 0)

  return {
    score,
    dimensions: {
      usage: usageScore,
      success: successScore,
      freshness: freshnessScore,
      redundancy: redundancyScore,
    },
    issues,
    byRule,
    archiveSkills: [...archiveSkills].sort(),
    duplicateSkills: [...duplicateSkills].sort(),
    tokensWasted,
    totals: { skills: total, calls: allCalls, used: used.length, fresh: fresh.length },
    generatedAt: new Date(time).toISOString(),
  }
}

function makeIssue(rule, skill, extra = {}) {
  return {
    rule,
    skill,
    action: RULES[rule].action,
    severity: RULES[rule].severity,
    ...extra,
  }
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Reminder gate: score below threshold or enough issues, and not silenced. */
export function reminderDue(health, config = {}, notify = {}, now = Date.now()) {
  const notifyConfig = { score_alert_below: 75, issue_alert_count: 10, ...config }
  if (notify.enabled === false) return false
  const time = now instanceof Date ? now.getTime() : Number(now)
  if (notify.silencedUntil && Date.parse(notify.silencedUntil) > time) return false
  const disabled = new Set(notify.disabledRules ?? [])
  const active = activeIssues(health.issues, disabled)
  if (active.length === 0) return false
  // Recovered: a score of 80 or more stops reminders even if old issues linger.
  if (health.score >= (notifyConfig.score_recover_above ?? 80)) return false
  return health.score < notifyConfig.score_alert_below || active.length >= notifyConfig.issue_alert_count
}

/** Remove rule classes the user closed; weekly reports keep using them. */
export function activeIssues(issues, disabledRules) {
  const disabled = disabledRules instanceof Set ? disabledRules : new Set(disabledRules ?? [])
  return issues.filter((issue) => !disabled.has(issue.rule))
}
