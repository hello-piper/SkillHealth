import test from 'node:test'
import assert from 'node:assert/strict'
import { makeEvent } from '../src/core/event.mjs'
import { pairEvents } from '../src/core/pairing.mjs'

const BASE = Date.parse('2026-10-27T09:00:00.000Z')

function start(overrides = {}) {
  return makeEvent({
    agent: 'dsh',
    skill: 'tdd',
    trigger: 'model',
    phase: 'start',
    session_id: 's1',
    cwd: '/tmp/x',
    via: 'tool-event',
    status: 'pending',
    ts: new Date(BASE).toISOString(),
    ...overrides,
  })
}

function end(overrides = {}) {
  return makeEvent({
    agent: 'dsh',
    skill: 'tdd',
    trigger: 'model',
    phase: 'end',
    session_id: 's1',
    cwd: '/tmp/x',
    via: 'tool-event',
    status: 'ok',
    ts: new Date(BASE + 500).toISOString(),
    ...overrides,
  })
}

test('pairs start and end by tool_use_id and keeps host duration', () => {
  const s = start({ tool_use_id: 'call-1' })
  const e = end({ tool_use_id: 'call-1', duration_ms: 4321 })
  const { calls, orphanEnds } = pairEvents([e, s], { now: BASE + 1000 })
  assert.equal(orphanEnds.length, 0)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].status, 'ok')
  assert.equal(calls[0].duration_ms, 4321)
  assert.equal(calls[0].call_key, s.id)
})

test('degrades to skill plus a second-level window without tool_use_id', () => {
  const s = start()
  const e = end({ ts: new Date(BASE + 4000).toISOString() })
  const { calls } = pairEvents([s, e], { now: BASE + 5000 })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].status, 'ok')
  assert.equal(calls[0].duration_ms, 4000)
})

test('a start with no end after 30 minutes becomes abort', () => {
  const s = start({ tool_use_id: 'call-2' })
  const { calls } = pairEvents([s], { now: BASE + 31 * 60 * 1000 })
  assert.equal(calls[0].status, 'abort')
  assert.equal(calls[0].error_code, 'aborted')
})

test('a recent unmatched start stays pending instead of inventing an abort', () => {
  const s = start({ tool_use_id: 'call-3' })
  const { calls } = pairEvents([s], { now: BASE + 60 * 1000 })
  assert.equal(calls[0].status, 'pending')
  assert.equal(calls[0].ended_at, null)
})

test('duplicate event ids are ignored', () => {
  const s = start({ tool_use_id: 'call-4' })
  const e = end({ tool_use_id: 'call-4' })
  const { calls, total } = pairEvents([s, s, e, e], { now: BASE + 1000 })
  assert.equal(total, 2)
  assert.equal(calls.length, 1)
})

test('an end without a start is reported as an orphan', () => {
  const e = end({ tool_use_id: 'call-5' })
  const { calls, orphanEnds } = pairEvents([e], { now: BASE + 1000 })
  assert.equal(calls.length, 0)
  assert.equal(orphanEnds.length, 1)
})
