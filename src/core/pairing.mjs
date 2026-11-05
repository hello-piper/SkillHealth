/**
 * Event pairing: start + end become one call.
 *
 * Merge key = session_id + tool_use_id; without a tool_use_id it degrades to
 * skill + a second-granularity time window. A start with no end after the
 * timeout is marked `abort` — that is where interruption data comes from.
 * Recent starts without an end stay `pending` and are resolved on a later
 * rebuild instead of being mislabelled.
 */

const SECOND = 1000

export function callKey(event) {
  return event.tool_use_id
    ? `tu:${event.session_id}\u0000${event.tool_use_id}`
    : `sk:${event.session_id}\u0000${event.skill}`
}

export function pairEvents(events, options = {}) {
  const now = options.now instanceof Date ? options.now.getTime() : Number(options.now ?? Date.now())
  const abortAfterMs = options.abortAfterMs ?? 30 * 60 * SECOND
  const fallbackWindowMs = options.fallbackWindowMs ?? 60 * SECOND

  const seen = new Set()
  const unique = []
  for (const event of events) {
    if (!event || typeof event.id !== 'string' || seen.has(event.id)) continue
    seen.add(event.id)
    unique.push(event)
  }

  const ordered = [...unique].sort((a, b) => {
    const delta = Date.parse(a.ts) - Date.parse(b.ts)
    if (delta !== 0) return delta
    return a.phase === b.phase ? 0 : a.phase === 'start' ? -1 : 1
  })

  const openByTool = new Map()
  const openFallback = []
  const calls = []
  const orphanEnds = []

  const pushOpen = (event) => {
    if (event.tool_use_id) {
      const key = callKey(event)
      if (!openByTool.has(key)) openByTool.set(key, [])
      openByTool.get(key).push(event)
    } else {
      openFallback.push(event)
    }
  }

  const takeFallback = (end) => {
    const endTs = Date.parse(end.ts)
    let bestIndex = -1
    for (let index = 0; index < openFallback.length; index += 1) {
      const start = openFallback[index]
      if (start.session_id !== end.session_id || start.skill !== end.skill) continue
      const delta = endTs - Date.parse(start.ts)
      if (delta < 0 || delta > fallbackWindowMs) continue
      if (bestIndex === -1 || Date.parse(openFallback[bestIndex].ts) < Date.parse(start.ts)) bestIndex = index
    }
    if (bestIndex === -1) return undefined
    return openFallback.splice(bestIndex, 1)[0]
  }

  for (const event of ordered) {
    if (event.phase === 'start') {
      pushOpen(event)
      continue
    }
    let start
    if (event.tool_use_id) {
      const bucket = openByTool.get(callKey(event))
      start = bucket?.shift()
    }
    if (!start) start = takeFallback(event)
    if (!start) {
      orphanEnds.push(event)
      continue
    }
    calls.push(buildCall(start, event))
  }

  const leftovers = [...openByTool.values()].flat().concat(openFallback)
  for (const start of leftovers) {
    const startTs = Date.parse(start.ts)
    if (now - startTs >= abortAfterMs) {
      calls.push(buildCall(start, undefined, { now, abortAfterMs }))
    } else {
      calls.push(buildCall(start, undefined, { pending: true }))
    }
  }

  calls.sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at) || a.skill.localeCompare(b.skill))
  return { calls, orphanEnds, total: unique.length, unique: unique.length }
}

function buildCall(start, end, options = {}) {
  const startedAt = start.ts
  const duration = end
    ? end.duration_ms ?? Math.max(0, Date.parse(end.ts) - Date.parse(start.ts))
    : undefined
  const status = end ? end.status : options.pending ? 'pending' : 'abort'
  const endedAt = end
    ? end.ts
    : options.pending
      ? null
      : new Date(Date.parse(start.ts) + (options.abortAfterMs ?? 30 * 60 * SECOND)).toISOString()

  return {
    call_key: start.id,
    session_id: start.session_id,
    agent: start.agent,
    skill: start.skill,
    trigger: start.trigger,
    status,
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: duration ?? null,
    cwd: start.cwd,
    prompt_hash: start.prompt_hash ?? null,
    tool_use_id: start.tool_use_id ?? null,
    via: start.via,
    error_code: end?.error_code ?? (status === 'abort' ? 'aborted' : null),
    agent_version: start.agent_version ?? null,
    start_event_id: start.id,
    end_event_id: end?.id ?? null,
  }
}
