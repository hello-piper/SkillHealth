import test from 'node:test'
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { EVENT_FIELDS, makeEvent } from '../src/core/event.mjs'
import { createFacade } from '../src/core/facade.mjs'
import { createDshAdapter } from '../src/adapters/dsh.mjs'
import { createClaudeCodeAdapter } from '../src/adapters/claude-code.mjs'

const NOW = '2026-10-27T09:00:00.000Z'
const CWD = join(homedir(), 'projects', 'demo')

function dshNative() {
  return {
    name: 'skill',
    callId: 'call_01',
    arguments: { name: 'tdd' },
    agent: { id: 'session-01' },
    signal: { aborted: false },
  }
}

function claudeNative(event) {
  return {
    hook_event_name: event,
    session_id: 'session-01',
    cwd: CWD,
    tool_name: 'Skill',
    tool_input: { name: 'tdd' },
    tool_use_id: 'call_01',
    tool_response: event === 'PostToolUse' ? { success: true } : undefined,
  }
}

function capture() {
  return {
    now: NOW,
    sessionId: 'session-01',
    cwd: CWD,
    promptHash: 'abcdef12',
    durationMs: 1234,
    trigger: 'user',
  }
}

test('both host facades emit exactly the contract field set', () => {
  const dsh = createFacade(createDshAdapter({ agentVersion: '9.9.9' }))
  const claude = createFacade(createClaudeCodeAdapter({ agentVersion: '9.9.9' }))
  const shared = capture()

  const dshStart = dsh.start(dshNative(), shared)
  const ccStart = claude.start(claudeNative('PreToolUse'), shared)
  const dshEnd = dsh.end(dshNative(), { isError: false }, shared)
  const ccEnd = claude.end(claudeNative('PostToolUse'), { isError: false }, shared)

  for (const event of [dshStart, ccStart, dshEnd, ccEnd]) {
    assert.equal(event.schema, 'skill-usage/1')
    for (const field of ['id', 'ts', 'schema', 'agent', 'skill', 'trigger', 'phase', 'session_id', 'cwd', 'via', 'status']) {
      assert.ok(field in event, `missing required field ${field}`)
    }
    for (const field of Object.keys(event)) {
      assert.ok(EVENT_FIELDS.includes(field), `unexpected field ${field}`)
    }
  }
  assert.deepEqual(Object.keys(dshStart), Object.keys(ccStart))
  assert.deepEqual(Object.keys(dshEnd), Object.keys(ccEnd))
  assert.equal(dshStart.cwd, '~/projects/demo')
  assert.equal(ccStart.cwd, '~/projects/demo')

  const dshError = dsh.end(dshNative(), { isError: true, error: { info: { code: 'boom' } } }, shared)
  const ccError = claude.end(
    { ...claudeNative('PostToolUse'), tool_response: { is_error: true, error: 'boom' } },
    { isError: true },
    shared,
  )
  assert.deepEqual(Object.keys(dshError), EVENT_FIELDS)
  assert.deepEqual(Object.keys(dshError), Object.keys(ccError))
})

test('start is always pending and end is ok|error|abort', () => {
  const dsh = createFacade(createDshAdapter({ agentVersion: '9.9.9' }))
  const start = dsh.start(dshNative(), capture())
  const end = dsh.end(dshNative(), { isError: false }, capture())
  assert.equal(start.phase, 'start')
  assert.equal(start.status, 'pending')
  assert.equal(end.phase, 'end')
  assert.equal(end.status, 'ok')

  const abortedExec = { ...dshNative(), signal: { aborted: true } }
  assert.equal(dsh.end(abortedExec, { isError: false }, capture()).status, 'abort')
  const failed = dsh.end(dshNative(), { isError: true, error: { info: { code: 'skill_not_found' } } }, capture())
  assert.equal(failed.status, 'error')
  assert.equal(failed.error_code, 'skill_not_found')
})

test('event ids are deterministic for replay and retry', () => {
  const dsh = createFacade(createDshAdapter({ agentVersion: '9.9.9' }))
  const first = dsh.start(dshNative(), capture())
  const second = dsh.start(dshNative(), capture())
  assert.equal(first.id, second.id)
  assert.equal(first.id.length, 32)
})

test('off-contract events are rejected instead of silently extended', () => {
  const dsh = createFacade(createDshAdapter({ agentVersion: '9.9.9' }))
  const start = dsh.start(dshNative(), capture())
  assert.throws(() => makeEvent({ ...start, secret_field: 'nope' }), /unknown field/)
  assert.throws(() => makeEvent({ ...start, status: 'ok' }), /start status/)
  assert.throws(() => makeEvent({ ...start, duration_ms: 10 }), /duration_ms/)
  assert.throws(() => makeEvent({ ...start, phase: 'end', status: 'pending' }), /end status/)
  assert.throws(() => makeEvent({ ...start, prompt_hash: 'not-a-hash' }), /prompt_hash/)
})

test('a non-skill tool produces no event', () => {
  const dsh = createFacade(createDshAdapter({ agentVersion: '9.9.9' }))
  assert.equal(dsh.start({ name: 'bash', callId: 'x', arguments: {}, signal: {} }, capture()), null)
  assert.equal(createFacade(createClaudeCodeAdapter()).start({ tool_name: 'Bash', tool_input: {} }, capture()), null)
})
