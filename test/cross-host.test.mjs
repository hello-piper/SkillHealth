import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCollector } from '../src/collector.mjs'
import { createDshAdapter } from '../src/adapters/dsh.mjs'
import { readCalls, readDaily } from '../src/store/sqlite.mjs'
import { listDayFiles } from '../src/store/jsonl.mjs'

const BIN = new URL('../bin/collect.mjs', import.meta.url).pathname

function runHook(root, payload) {
  const result = spawnSync(process.execPath, [BIN, '--root', root], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 10_000,
  })
  assert.equal(result.status, 0, result.stderr)
}

test('two hosts append to one stream and one index partitioned by agent', () => {
  const root = mkdtempSync(join(tmpdir(), 'skilltrace-hosts-'))
  try {
    runHook(root, {
      hook_event_name: 'PreToolUse',
      session_id: 'cc-1',
      cwd: '/tmp/cc',
      tool_name: 'Skill',
      tool_input: { name: 'weather' },
      tool_use_id: 'call-cc',
    })
    runHook(root, {
      hook_event_name: 'PostToolUse',
      session_id: 'cc-1',
      cwd: '/tmp/cc',
      tool_name: 'Skill',
      tool_input: { name: 'weather' },
      tool_use_id: 'call-cc',
      tool_response: { success: true },
    })

    const collector = createCollector({
      root,
      host: 'dsh',
      adapter: createDshAdapter({ agentVersion: '0.2.1' }),
      config: { collect: { fallback_window_ms: 60_000, abort_after_ms: 1_800_000, rebuild_debounce_ms: 10 } },
    })
    const native = {
      name: 'skill',
      callId: 'call-dsh',
      arguments: { name: 'tdd' },
      agent: { id: 'dsh-1' },
      signal: { aborted: false },
    }
    collector.start(native, { sessionId: 'dsh-1', cwd: '/tmp/dsh', now: '2026-10-27T09:00:00.000Z' })
    collector.end(native, { isError: false }, { sessionId: 'dsh-1', cwd: '/tmp/dsh', now: '2026-10-27T09:00:01.000Z', durationMs: 1000 })
    collector.rebuild([])
    collector.dispose()

    const lines = listDayFiles(join(root, 'events'))
      .flatMap((file) => readFileSync(file, 'utf8').trim().split('\n'))
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    assert.equal(lines.length, 4)
    assert.deepEqual([...new Set(lines.map((line) => line.agent))].sort(), ['claude-code', 'dsh'])

    const calls = readCalls(join(root, 'index.sqlite3'))
    assert.equal(calls.length, 2)
    assert.deepEqual([...new Set(calls.map((call) => call.agent))].sort(), ['claude-code', 'dsh'])
    assert.equal(readDaily(join(root, 'rollup.sqlite3')).length, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
