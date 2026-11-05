/**
 * SQLite artifacts. index.sqlite3 holds the paired, de-duplicated index;
 * rollup.sqlite3 holds day/skill/agent aggregates, skill metadata, cooccurrence
 * and health snapshots. Both are rebuilt from `events/` on demand.
 */
import { existsSync, renameSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const INDEX_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS event_seen (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  agent TEXT NOT NULL,
  skill TEXT NOT NULL,
  phase TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS calls (
  call_key TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  skill TEXT NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_ms INTEGER,
  cwd TEXT NOT NULL,
  prompt_hash TEXT,
  tool_use_id TEXT,
  via TEXT NOT NULL,
  error_code TEXT,
  agent_version TEXT,
  start_event_id TEXT NOT NULL,
  end_event_id TEXT
);
CREATE INDEX IF NOT EXISTS calls_skill ON calls(skill);
CREATE INDEX IF NOT EXISTS calls_agent ON calls(agent);
CREATE INDEX IF NOT EXISTS calls_started ON calls(started_at);
CREATE INDEX IF NOT EXISTS calls_session ON calls(session_id);
`

const ROLLUP_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rollup_daily (
  day TEXT NOT NULL,
  agent TEXT NOT NULL,
  skill TEXT NOT NULL,
  calls INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  error INTEGER NOT NULL,
  abort INTEGER NOT NULL,
  p50_ms INTEGER,
  p95_ms INTEGER,
  tokens_est INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, agent, skill)
);
CREATE TABLE IF NOT EXISTS skill_meta (
  skill TEXT PRIMARY KEY,
  first_used_at TEXT,
  last_used_at TEXT,
  calls INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 0,
  error INTEGER NOT NULL DEFAULT 0,
  abort INTEGER NOT NULL DEFAULT 0,
  install_path TEXT,
  description_fingerprint TEXT,
  category TEXT,
  installed_at TEXT,
  tokens_est INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cooccur (
  session_id TEXT NOT NULL,
  skill_a TEXT NOT NULL,
  skill_b TEXT NOT NULL,
  PRIMARY KEY (session_id, skill_a, skill_b)
);
CREATE TABLE IF NOT EXISTS health_snapshot (
  scanned_at TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  score INTEGER NOT NULL,
  usage_score INTEGER NOT NULL,
  success_score INTEGER NOT NULL,
  freshness_score INTEGER NOT NULL,
  redundancy_score INTEGER NOT NULL,
  issues_count INTEGER NOT NULL,
  issues_json TEXT NOT NULL
);
`

function tempPath(path) {
  return `${path}.tmp-${process.pid}-${Date.now()}`
}

function replaceDb(path, build) {
  const temp = tempPath(path)
  rmSync(temp, { force: true })
  const db = new DatabaseSync(temp)
  try {
    db.exec('PRAGMA journal_mode = DELETE;')
    db.exec('BEGIN')
    build(db)
    db.exec('COMMIT')
    db.close()
    // Old sidecars belong to the database being replaced. Leaving them in place
    // lets SQLite replay an unrelated WAL against the fresh file.
    rmSync(`${path}-wal`, { force: true })
    rmSync(`${path}-shm`, { force: true })
    rmSync(path, { force: true })
    renameSync(temp, path)
  } catch (error) {
    try { db.close() } catch {}
    rmSync(temp, { force: true })
    throw error
  }
}

/** Rebuild index.sqlite3 atomically from validated events and paired calls. */
export function writeIndex(path, events, calls, meta = {}) {
  replaceDb(path, (db) => {
    db.exec(INDEX_SCHEMA)
    const seen = db.prepare('INSERT OR IGNORE INTO event_seen (id, day, agent, skill, phase) VALUES (?, ?, ?, ?, ?)')
    for (const event of events) {
      seen.run(event.id, String(event.ts).slice(0, 10), event.agent, event.skill, event.phase)
    }
    const insert = db.prepare(`
      INSERT OR REPLACE INTO calls (
        call_key, session_id, agent, skill, trigger, status, started_at, ended_at,
        duration_ms, cwd, prompt_hash, tool_use_id, via, error_code, agent_version,
        start_event_id, end_event_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const call of calls) {
      insert.run(
        call.call_key, call.session_id, call.agent, call.skill, call.trigger, call.status,
        call.started_at, call.ended_at, call.duration_ms, call.cwd, call.prompt_hash,
        call.tool_use_id, call.via, call.error_code, call.agent_version,
        call.start_event_id, call.end_event_id,
      )
    }
    const metaInsert = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
    for (const [key, value] of Object.entries(meta)) metaInsert.run(key, JSON.stringify(value))
  })
}

/** Rebuild rollup.sqlite3, preserving prior health snapshots when available. */
export function writeRollup(path, aggregate, skills, meta = {}) {
  const previousHealth = readHealthSnapshots(path, 500)
  replaceDb(path, (db) => {
    db.exec(ROLLUP_SCHEMA)
    const daily = db.prepare(`
      INSERT OR REPLACE INTO rollup_daily
        (day, agent, skill, calls, ok, error, abort, p50_ms, p95_ms, tokens_est)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const row of aggregate.daily) {
      daily.run(row.day, row.agent, row.skill, row.calls, row.ok, row.error, row.abort,
        row.p50_ms, row.p95_ms, row.tokens_est)
    }

    const byName = new Map(skills.map((skill) => [skill.name, skill]))
    const metaInsert = db.prepare(`
      INSERT OR REPLACE INTO skill_meta (
        skill, first_used_at, last_used_at, calls, ok, error, abort,
        install_path, description_fingerprint, category, installed_at, tokens_est
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const statsByName = new Map(aggregate.skillMeta.map((row) => [row.skill, row]))
    for (const skill of skills) {
      const stats = statsByName.get(skill.name) ?? {
        first_used_at: null, last_used_at: null, calls: 0, ok: 0, error: 0, abort: 0,
      }
      metaInsert.run(
        skill.name, stats.first_used_at, stats.last_used_at, stats.calls, stats.ok, stats.error, stats.abort,
        skill.install_path ?? skill.path ?? null, skill.description_fingerprint ?? null,
        skill.category ?? null, skill.installed_at ?? null, skill.tokens_est ?? 0,
      )
    }
    for (const row of aggregate.skillMeta) {
      if (byName.has(row.skill)) continue
      metaInsert.run(
        row.skill, row.first_used_at, row.last_used_at, row.calls, row.ok, row.error, row.abort,
        null, null, null, null, row.tokens_est ?? 0,
      )
    }

    const cooccur = db.prepare('INSERT OR IGNORE INTO cooccur (session_id, skill_a, skill_b) VALUES (?, ?, ?)')
    for (const row of aggregate.cooccur) cooccur.run(row.session_id, row.skill_a, row.skill_b)

    const metaInsertStmt = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
    for (const [key, value] of Object.entries(meta)) metaInsertStmt.run(key, JSON.stringify(value))

    const health = db.prepare(`
      INSERT OR REPLACE INTO health_snapshot (
        scanned_at, agent, score, usage_score, success_score, freshness_score,
        redundancy_score, issues_count, issues_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const row of previousHealth) {
      health.run(row.scanned_at, row.agent, row.score, row.usage_score, row.success_score,
        row.freshness_score, row.redundancy_score, row.issues_count, row.issues_json)
    }
  })
}

export function readHealthSnapshots(path, limit = 100) {
  if (!existsSync(path)) return []
  let db
  try {
    db = new DatabaseSync(path, { readOnly: true })
    return db.prepare('SELECT * FROM health_snapshot ORDER BY scanned_at DESC LIMIT ?')
      .all(limit)
      .map((row) => ({ ...row }))
  } catch {
    return []
  } finally {
    try { db?.close() } catch {}
  }
}

/** Append one health snapshot (and keep the newest 500 rows). */
export function recordHealth(path, snapshot) {
  const db = new DatabaseSync(path)
  try {
    db.exec(ROLLUP_SCHEMA)
    db.prepare(`
      INSERT OR REPLACE INTO health_snapshot (
        scanned_at, agent, score, usage_score, success_score, freshness_score,
        redundancy_score, issues_count, issues_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshot.scanned_at, snapshot.agent, snapshot.score, snapshot.usage_score,
      snapshot.success_score, snapshot.freshness_score, snapshot.redundancy_score,
      snapshot.issues_count, snapshot.issues_json,
    )
    db.exec(`
      DELETE FROM health_snapshot WHERE scanned_at NOT IN (
        SELECT scanned_at FROM health_snapshot ORDER BY scanned_at DESC LIMIT 500
      )
    `)
  } finally {
    db.close()
  }
}

export function readCalls(path) {
  if (!existsSync(path)) return []
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare('SELECT * FROM calls ORDER BY started_at').all().map((row) => ({ ...row }))
  } finally {
    db.close()
  }
}

export function readDaily(path, sinceDay = '0000-00-00') {
  if (!existsSync(path)) return []
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare('SELECT * FROM rollup_daily WHERE day >= ? ORDER BY day, calls DESC')
      .all(sinceDay)
      .map((row) => ({ ...row }))
  } finally {
    db.close()
  }
}

export function readSkillMeta(path) {
  if (!existsSync(path)) return []
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare('SELECT * FROM skill_meta ORDER BY calls DESC, skill').all().map((row) => ({ ...row }))
  } finally {
    db.close()
  }
}

export function readCooccur(path) {
  if (!existsSync(path)) return []
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare('SELECT * FROM cooccur').all().map((row) => ({ ...row }))
  } finally {
    db.close()
  }
}
