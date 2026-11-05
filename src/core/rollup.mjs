/**
 * Aggregation: rollup_daily, skill_meta, cooccur. Everything here is derived
 * from paired calls plus the live catalog, so deleting rollup.sqlite3 is safe.
 */

export function dayOf(iso) {
  return String(iso ?? '').slice(0, 10)
}

export function percentile(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]
  const rank = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(rank)
  const upper = Math.ceil(rank)
  if (lower === upper) return sorted[lower]
  return Math.round(sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower))
}

const TERMINAL = new Set(['ok', 'error', 'abort'])

export function aggregate(calls, skills = []) {
  const skillTokens = new Map(skills.map((skill) => [skill.name, skill.tokens_est ?? 0]))
  const daily = new Map()
  const perSkill = new Map()
  const sessions = new Map()

  for (const call of calls) {
    if (!TERMINAL.has(call.status)) continue
    const key = `${dayOf(call.started_at)}\u0000${call.agent}\u0000${call.skill}`
    if (!daily.has(key)) {
      daily.set(key, {
        day: dayOf(call.started_at),
        agent: call.agent,
        skill: call.skill,
        calls: 0,
        ok: 0,
        error: 0,
        abort: 0,
        durations: [],
      })
    }
    const row = daily.get(key)
    row.calls += 1
    if (call.status === 'ok') row.ok += 1
    if (call.status === 'error') row.error += 1
    if (call.status === 'abort') row.abort += 1
    if (Number.isFinite(call.duration_ms)) row.durations.push(call.duration_ms)

    if (!perSkill.has(call.skill)) {
      perSkill.set(call.skill, {
        skill: call.skill,
        first_used_at: call.started_at,
        last_used_at: call.ended_at ?? call.started_at,
        calls: 0,
        ok: 0,
        error: 0,
        abort: 0,
      })
    }
    const meta = perSkill.get(call.skill)
    meta.calls += 1
    if (call.status === 'ok') meta.ok += 1
    if (call.status === 'error') meta.error += 1
    if (call.status === 'abort') meta.abort += 1
    if (Date.parse(call.started_at) < Date.parse(meta.first_used_at)) meta.first_used_at = call.started_at
    const usedAt = call.ended_at ?? call.started_at
    if (Date.parse(usedAt) > Date.parse(meta.last_used_at)) meta.last_used_at = usedAt

    if (!sessions.has(call.session_id)) sessions.set(call.session_id, new Set())
    sessions.get(call.session_id).add(call.skill)
  }

  const dailyRows = [...daily.values()].map((row) => ({
    day: row.day,
    agent: row.agent,
    skill: row.skill,
    calls: row.calls,
    ok: row.ok,
    error: row.error,
    abort: row.abort,
    p50_ms: percentile(row.durations, 50),
    p95_ms: percentile(row.durations, 95),
    tokens_est: skillTokens.get(row.skill) ?? 0,
  }))

  const skillMeta = [...perSkill.values()].map((row) => ({
    ...row,
    description: '',
    description_fingerprint: null,
    install_path: null,
    category: null,
    installed_at: null,
    tokens_est: skillTokens.get(row.skill) ?? 0,
  }))

  const cooccur = []
  for (const [sessionId, set] of sessions) {
    const names = [...set].sort()
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        cooccur.push({ session_id: sessionId, skill_a: names[i], skill_b: names[j] })
      }
    }
  }

  return { daily: dailyRows, skillMeta, cooccur }
}
