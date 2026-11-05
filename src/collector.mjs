/**
 * Collector: the only writer of the shared event stream. Every entry point is
 * wrapped so a plugin or hook failure can never propagate into a tool call;
 * failures land in collector.log instead.
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { createFacade } from './core/facade.mjs'
import { makeEvent } from './core/event.mjs'
import { pairEvents } from './core/pairing.mjs'
import { aggregate } from './core/rollup.mjs'
import { appendEvent, readEvents } from './store/jsonl.mjs'
import { layout, ensureLayout } from './store/paths.mjs'
import { writeIndex, writeRollup } from './store/sqlite.mjs'

const MAX_LOG_BYTES = 4 * 1024 * 1024

export function createCollector({ root, host, adapter, config, onEvent = () => {} }) {
  const paths = layout(root)
  ensureLayout(paths, host)
  const facade = createFacade(adapter)
  let timer = null
  let cache = {
    events: [],
    calls: [],
    daily: [],
    skillMeta: [],
    cooccur: [],
    lines: 0,
    duplicates: 0,
    builtAt: null,
  }

  function log(level, message, detail) {
    try {
      rotateLog(paths.collectorLog)
      const suffix = detail === undefined ? '' : ` ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`
      const line = `${new Date().toISOString()} [${host}] ${level} ${message}${suffix}\n`
      appendFileSync(paths.collectorLog, line, 'utf8')
    } catch {
      // Logging must not become the failure.
    }
  }

  function safe(label, operation) {
    try {
      return operation()
    } catch (error) {
      log('error', label, error instanceof Error ? error.message : String(error))
      return null
    }
  }

  function scheduleRebuild() {
    if (timer) return
    const delay = config.collect?.rebuild_debounce_ms ?? 1200
    timer = setTimeout(() => {
      timer = null
      safe('scheduled rebuild', () => rebuild())
    }, delay)
    timer.unref?.()
  }

  log('info', 'collector ready', { adapter: facade.adapterId, hookVersion: adapter.hookVersion })

  function persist(event, label) {
    if (!event) return null
    try {
      appendEvent(paths.events, event)
      onEvent(event)
      scheduleRebuild()
      return event
    } catch (error) {
      log('discard', label, { id: event.id, message: error instanceof Error ? error.message : String(error) })
      return null
    }
  }

  function rebuild(skills = []) {
    const { events, lines, duplicates } = readEvents(paths.events, (problem) => {
      log(problem.kind === 'schema' ? 'schema' : 'discard', `${problem.kind} error`, {
        file: problem.file,
        line: problem.line,
        message: problem.message,
      })
    })
    const paired = pairEvents(events, {
      abortAfterMs: config.collect?.abort_after_ms ?? 30 * 60 * 1000,
      fallbackWindowMs: config.collect?.fallback_window_ms ?? 60 * 1000,
    })
    for (const orphan of paired.orphanEnds.slice(0, 20)) {
      log('discard', 'end without start', { id: orphan.id, session_id: orphan.session_id, skill: orphan.skill })
    }
    const rolled = aggregate(paired.calls, skills)
    const builtAt = new Date().toISOString()
    writeIndex(paths.indexDb, events, paired.calls, { built_at: builtAt, events: events.length, calls: paired.calls.length })
    writeRollup(paths.rollupDb, rolled, skills, { built_at: builtAt, events: events.length, calls: paired.calls.length })
    cache = { ...rolled, calls: paired.calls, events, lines, duplicates, builtAt }
    return cache
  }

  return {
    paths,
    facade,
    log,
    rebuild,
    start(native, capture = {}) {
      return safe('start', () => persist(facade.start(native, { now: new Date().toISOString(), ...capture }), 'start'))
    },
    end(native, result, capture = {}) {
      return safe('end', () => persist(facade.end(native, result, { now: new Date().toISOString(), ...capture }), 'end'))
    },
    ingest(value) {
      return safe('ingest', () => persist(makeEvent(value), 'ingest'))
    },
    calls() {
      return cache.calls
    },
    daily() {
      return cache.daily
    },
    cooccur() {
      return cache.cooccur
    },
    skillMeta() {
      return cache.skillMeta
    },
    builtAt() {
      return cache.builtAt
    },
    dispose() {
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}

function rotateLog(path) {
  try {
    if (!existsSync(path)) return
    if (statSync(path).size < MAX_LOG_BYTES) return
    const previous = `${path}.1`
    rmSync(previous, { force: true })
    renameSync(path, previous)
  } catch {
    // Best effort.
  }
}

/** Ensure the root tree exists without opening any database. */
export function ensureRoot(root, host) {
  const paths = layout(root)
  mkdirSync(paths.events, { recursive: true })
  ensureLayout(paths, host)
  return paths
}
