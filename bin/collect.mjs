#!/usr/bin/env node
/**
 * Hook receiver for hosts without an in-process plugin API.
 *
 * Claude Code pipes one hook payload as JSON on stdin:
 *   PreToolUse  -> start
 *   PostToolUse -> end
 * It appends to the same shared event stream as the DSH plugin, so `agent`
 * stays the only partition and the databases remain a rebuildable cache.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createCollector } from '../src/collector.mjs'
import { loadHostConfig } from '../src/config.mjs'
import { createClaudeCodeAdapter } from '../src/adapters/claude-code.mjs'
import { ensureRoot } from '../src/collector.mjs'
import { readJson, writeJson } from '../src/store/files.mjs'
import { expandRoot, layout } from '../src/store/paths.mjs'

const HOST = 'claude-code'

function readArgs(argv) {
  const out = {}
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith('--')) {
      const key = argv[index].slice(2)
      out[key] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true
    }
  }
  return out
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function pendingPath(root, payload) {
  const id = String(payload.tool_use_id ?? payload.session_id ?? 'unknown').replace(/[^A-Za-z0-9_.-]/g, '_')
  return join(root, 'agents', HOST, 'pending', `${id}.json`)
}

function main() {
  const args = readArgs(process.argv.slice(2))
  const root = expandRoot(args.root)
  ensureRoot(root, HOST)
  const paths = layout(root)
  const config = loadHostConfig({ paths, host: HOST })
  const adapter = createClaudeCodeAdapter()
  const own = paths.host(HOST)
  const previousInstall = readJson(own.install, {})
  writeJson(own.install, {
    host: HOST,
    adapter: adapter.id,
    hookVersion: adapter.hookVersion,
    installedAt: previousInstall.installedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    registration: { capture: 'PreToolUse/PostToolUse hooks via bin/collect.mjs' },
  })
  const collector = createCollector({ root, host: HOST, adapter, config })

  let payload
  try {
    payload = JSON.parse(readStdin() || '{}')
  } catch {
    collector.log('discard', 'hook payload is not JSON')
    return
  }

  const phase = args.phase ?? (payload.hook_event_name === 'PostToolUse' ? 'end' : 'start')
  try {
    if (phase === 'start') {
      const event = collector.start(payload, {
        sessionId: payload.session_id,
        cwd: payload.cwd,
        trigger: payload.trigger ?? 'model',
      })
      if (event) {
        mkdirSync(dirname(pendingPath(root, payload)), { recursive: true })
        writeFileSync(pendingPath(root, payload), JSON.stringify({ ts: event.ts }), 'utf8')
      }
    } else {
      let durationMs
      try {
        const started = JSON.parse(readFileSync(pendingPath(root, payload), 'utf8'))
        durationMs = Math.max(0, Date.now() - Date.parse(started.ts))
      } catch {
        durationMs = undefined
      }
      collector.end(payload, payload.tool_response, {
        sessionId: payload.session_id,
        cwd: payload.cwd,
        trigger: payload.trigger ?? 'model',
        durationMs,
        aborted: payload.tool_response?.aborted === true,
      })
      rmSync(pendingPath(root, payload), { force: true })
    }
  } finally {
    try {
      collector.rebuild()
    } catch (error) {
      collector.log('error', 'receiver rebuild failed', error instanceof Error ? error.message : String(error))
    }
    collector.dispose()
  }
}

try {
  main()
} catch (error) {
  try {
    const root = expandRoot(readArgs(process.argv.slice(2)).root)
    const paths = layout(root)
    const line = `${new Date().toISOString()} [${HOST}] error hook receiver crashed ${error instanceof Error ? error.message : String(error)}\n`
    mkdirSync(root, { recursive: true })
    writeFileSync(paths.collectorLog, line, { flag: 'a' })
  } catch {
    // A hook must never break the tool call it observes.
  }
}
