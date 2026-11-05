/**
 * Append-only JSONL event stream. Appending never rewrites a line; ingest is
 * idempotent because event ids are deterministic.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertEvent } from '../core/event.mjs'
import { dayFileName } from './paths.mjs'

export function appendEvent(dir, event) {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, dayFileName(new Date(event.ts)))
  appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8')
  return file
}

export function listDayFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
    .sort()
    .map((name) => join(dir, name))
}

/**
 * Read every event, de-duplicated by id. Malformed or off-contract lines are
 * reported through `onError` and skipped instead of failing the rebuild.
 */
export function readEvents(dir, onError = () => {}) {
  const byId = new Map()
  let lines = 0
  for (const file of listDayFiles(dir)) {
    const text = readFileSync(file, 'utf8')
    let lineNumber = 0
    for (const line of text.split(/\r?\n/)) {
      lineNumber += 1
      if (!line.trim()) continue
      lines += 1
      let parsed
      try {
        parsed = JSON.parse(line)
      } catch (error) {
        onError({ kind: 'json', file, line: lineNumber, message: error.message })
        continue
      }
      let event
      try {
        event = assertEvent(parsed)
      } catch (error) {
        onError({ kind: 'schema', file, line: lineNumber, message: error.message })
        continue
      }
      byId.set(event.id, event)
    }
  }
  return { events: [...byId.values()], lines, duplicates: lines - byId.size }
}

export function readDay(dir, date = new Date()) {
  const file = join(dir, dayFileName(date))
  if (!existsSync(file)) return []
  const events = []
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      events.push(assertEvent(JSON.parse(line)))
    } catch {
      // The UI's detail view is best-effort; the collector log owns diagnostics.
    }
  }
  return events
}
