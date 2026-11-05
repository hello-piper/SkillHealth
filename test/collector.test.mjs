import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCollector } from '../src/collector.mjs'
import { createDshAdapter } from '../src/adapters/dsh.mjs'
import { readCalls, readDaily, readSkillMeta } from '../src/store/sqlite.mjs'
import { listDayFiles } from '../src/store/jsonl.mjs'
import { layout } from '../src/store/paths.mjs'

test('collector writes one stream, rebuilds both databases, and survives deletion', () => {
  const root = mkdtempSync(join(tmpdir(), 'skilltrace-'))
  const paths = layout(root)
  const config = {
    collect: { fallback_window_ms: 60_000, abort_after_ms: 1_800_000, rebuild_debounce_ms: 10 },
  }
  const collector = createCollector({ root, host: 'dsh', adapter: createDshAdapter({ agentVersion: '0.2.1' }), config })
  const native = {
    name: 'skill',
    callId: 'call-1',
    arguments: { name: 'tdd' },
    agent: { id: 'session-1' },
    signal: { aborted: false },
  }
  const now = '2026-10-27T09:00:00.000Z'
  try {
    collector.start(native, { sessionId: 'session-1', cwd: '/tmp/workspace', promptHash: 'deadbeef', now })
    collector.end(native, { isError: false }, { sessionId: 'session-1', cwd: '/tmp/workspace', now, durationMs: 1500 })

    const files = listDayFiles(paths.events)
    assert.equal(files.length, 1)
    assert.match(files[0], /2026-10-27\.jsonl$/)
    const lines = readFileSync(files[0], 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(lines.length, 2)
    assert.deepEqual(Object.keys(lines[0]).slice(0, 11), [
      'id', 'ts', 'schema', 'agent', 'skill', 'trigger', 'phase', 'session_id', 'cwd', 'via', 'status',
    ])
    assert.equal(lines[0].agent, 'dsh')
    assert.equal(lines[0].status, 'pending')

    const skills = [{
      name: 'tdd',
      description: 'Test driven development',
      category: 'bundled',
      exists: true,
      installed_at: now,
      tokens_est: 42,
      install_path: '/skills/tdd',
      description_fingerprint: 'abcd1234',
    }]
    collector.rebuild(skills)

    const calls = readCalls(paths.indexDb)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].status, 'ok')
    assert.equal(calls[0].duration_ms, 1500)
    const daily = readDaily(paths.rollupDb)
    assert.equal(daily.length, 1)
    assert.equal(daily[0].calls, 1)
    assert.equal(daily[0].p50_ms, 1500)
    const meta = readSkillMeta(paths.rollupDb)
    assert.equal(meta[0].tokens_est, 42)
    assert.equal(meta[0].description_fingerprint, 'abcd1234')

    rmSync(paths.indexDb, { force: true })
    rmSync(paths.rollupDb, { force: true })
    collector.rebuild(skills)
    assert.equal(readCalls(paths.indexDb).length, 1)
    assert.equal(readDaily(paths.rollupDb).length, 1)

    assert.equal(collector.ingest({ schema: 'wrong' }), null)
    assert.ok(existsSync(paths.collectorLog))
    assert.match(readFileSync(paths.collectorLog, 'utf8'), /\[dsh\]/)
  } finally {
    collector.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})
