/**
 * The one event contract every SkillHealth host produces.
 *
 * Host differences (registration, callback timing, payload fields) live in
 * `src/adapters/`. A facade may only call `makeEvent()`; this module owns the
 * field set, so no host can add a field behind another host's back.
 */
import { createHash } from 'node:crypto'
import { foldHome } from './privacy.mjs'

export const EVENT_SCHEMA = 'skill-usage/1'

export const REQUIRED_FIELDS = Object.freeze([
  'id',
  'ts',
  'schema',
  'agent',
  'skill',
  'trigger',
  'phase',
  'session_id',
  'cwd',
  'via',
  'status',
])

export const OPTIONAL_FIELDS = Object.freeze([
  'tool_use_id',
  'prompt_hash',
  'duration_ms',
  'error_code',
  'agent_version',
])

export const EVENT_FIELDS = Object.freeze([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS])

export const PHASES = Object.freeze(['start', 'end'])
export const START_STATUS = 'pending'
export const END_STATUSES = Object.freeze(['ok', 'error', 'abort'])
export const TRIGGERS = Object.freeze(['model', 'user', 'subagent', 'schedule'])
export const VIAS = Object.freeze(['tool-event', 'hook', 'cli'])

const OPTIONAL_ORDER = OPTIONAL_FIELDS
const HEX8 = /^[0-9a-f]{8}$/

function fail(message) {
  throw new TypeError(`skill-usage event: ${message}`)
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${field} must be a non-empty string`)
  return value
}

function normalizeTs(value) {
  const date = value === undefined ? new Date() : value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) fail('ts must be a valid date')
  return date.toISOString()
}

function stableHash(value) {
  return createHash('sha1').update(value).digest('hex')
}

/**
 * Deterministic event id: replaying the same start/end pair yields the same id,
 * so the append-only log stays idempotent after a retry.
 */
export function makeEventId({ agent, session_id, tool_use_id, skill, ts, phase }) {
  const second = String(Math.floor(new Date(ts).getTime() / 1000))
  const pair = tool_use_id ? `tu:${tool_use_id}` : `sk:${skill}:${second}`
  return stableHash(`${agent}\u0000${session_id}\u0000${pair}\u0000${phase}`).slice(0, 32)
}

/**
 * Build one contract event. Unknown fields are rejected, optional fields are
 * emitted only when supplied, and key order is fixed so host outputs compare
 * byte-for-byte in the parity test.
 *
 * @param {object} input raw values from an adapter
 * @returns {Readonly<object>} the frozen event
 */
export function makeEvent(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    fail('input must be an object')
  }
  for (const key of Object.keys(input)) {
    if (!EVENT_FIELDS.includes(key)) fail(`unknown field "${key}"`)
  }

  const phase = requireString(input.phase, 'phase')
  if (!PHASES.includes(phase)) fail(`phase must be one of ${PHASES.join(', ')}`)

  const status = requireString(input.status, 'status')
  if (phase === 'start' && status !== START_STATUS) fail(`start status must be "${START_STATUS}"`)
  if (phase === 'end' && !END_STATUSES.includes(status)) {
    fail(`end status must be one of ${END_STATUSES.join(', ')}`)
  }

  const trigger = requireString(input.trigger, 'trigger')
  if (!TRIGGERS.includes(trigger)) fail(`trigger must be one of ${TRIGGERS.join(', ')}`)

  const via = requireString(input.via, 'via')
  if (!VIAS.includes(via)) fail(`via must be one of ${VIAS.join(', ')}`)

  if (input.schema !== undefined && input.schema !== EVENT_SCHEMA) {
    fail(`schema must be "${EVENT_SCHEMA}"`)
  }

  const ts = normalizeTs(input.ts)
  const agent = requireString(input.agent, 'agent')
  const skill = requireString(input.skill, 'skill')
  const session_id = requireString(input.session_id, 'session_id')
  const cwd = foldHome(requireString(input.cwd, 'cwd'))

  const event = {
    id: input.id === undefined
      ? makeEventId({ agent, session_id, tool_use_id: input.tool_use_id, skill, ts, phase })
      : requireString(input.id, 'id'),
    ts,
    schema: EVENT_SCHEMA,
    agent,
    skill,
    trigger,
    phase,
    session_id,
    cwd,
    via,
    status,
  }

  if (event.id.length < 8) fail('id must be at least 8 characters')

  const toolUseId = input.tool_use_id
  if (toolUseId !== undefined) event.tool_use_id = requireString(toolUseId, 'tool_use_id')

  if (input.prompt_hash !== undefined) {
    if (typeof input.prompt_hash !== 'string' || !HEX8.test(input.prompt_hash)) {
      fail('prompt_hash must be the first 8 hex characters of a sha1')
    }
    event.prompt_hash = input.prompt_hash
  }

  if (input.duration_ms !== undefined) {
    if (phase !== 'end') fail('duration_ms is only valid on an end event')
    const duration = input.duration_ms
    if (!Number.isInteger(duration) || duration < 0) fail('duration_ms must be a non-negative integer')
    event.duration_ms = duration
  }

  if (input.error_code !== undefined) {
    if (phase !== 'end') fail('error_code is only valid on an end event')
    event.error_code = requireString(input.error_code, 'error_code').slice(0, 64)
  }

  if (input.agent_version !== undefined) {
    event.agent_version = requireString(input.agent_version, 'agent_version').slice(0, 64)
  }

  // Fixed optional order, independent of the adapter's object order.
  const ordered = {}
  for (const key of REQUIRED_FIELDS) ordered[key] = event[key]
  for (const key of OPTIONAL_ORDER) if (key in event) ordered[key] = event[key]

  return Object.freeze(ordered)
}

/** Validate a stored event without rewriting it (rebuild and ingest paths). */
export function assertEvent(event) {
  return makeEvent(event)
}

/** Field names present on one event, in contract order. */
export function eventFields(event) {
  return EVENT_FIELDS.filter((key) => key in event)
}

/** First 8 hex characters of a sha1; used for prompts and descriptions. */
export function fingerprint(value) {
  return stableHash(String(value ?? '')).slice(0, 8)
}
