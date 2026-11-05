/**
 * On-disk layout. One event stream and one pair of databases are shared by
 * every host; only per-host state (health, notify, config, install) is split.
 */
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const DEFAULT_ROOT = '~/.agents/_skill-usage-stats'

export const DEFAULT_CONFIG = Object.freeze({
  host: 'dsh',
  schema: 'skill-usage/1',
  collect: {
    fallback_window_ms: 60_000,
    abort_after_ms: 1_800_000,
    rebuild_debounce_ms: 1200,
  },
  health: {
    unused_days: 30,
    stale_days: 60,
    stale_max_calls: 3,
    fresh_days: 30,
    duplicate_similarity: 0.8,
    failure_min_calls: 10,
    failure_rate: 0.15,
    conflict_cooccurrence: 3,
    conflict_overlap: 0.6,
    score_alert_below: 75,
    score_recover_above: 80,
    issue_alert_count: 10,
  },
  notify: {
    enabled: true,
    terminal: true,
    system: true,
    banner: true,
    cooldown_hours: 24,
    ignore_days: 14,
    weekly: true,
  },
})

export function expandRoot(root = DEFAULT_ROOT) {
  if (!root) return join(homedir(), '.agents', '_skill-usage-stats')
  if (root === '~') return homedir()
  if (root.startsWith('~/')) return resolve(homedir(), root.slice(2))
  return resolve(root)
}

export function layout(root) {
  const hostRoot = join(root, 'agents')
  return {
    root,
    events: join(root, 'events'),
    indexDb: join(root, 'index.sqlite3'),
    rollupDb: join(root, 'rollup.sqlite3'),
    collectorLog: join(root, 'collector.log'),
    hostRoot,
    hostDir(host) {
      return join(hostRoot, host)
    },
    host: (host) => ({
      dir: join(hostRoot, host),
      health: join(hostRoot, host, 'health.json'),
      healthState: join(hostRoot, host, 'health-state.json'),
      config: join(hostRoot, host, 'config.toml'),
      notify: join(hostRoot, host, 'notify.json'),
      install: join(hostRoot, host, 'install.json'),
    }),
  }
}

export function ensureLayout(paths, host) {
  mkdirSync(paths.events, { recursive: true })
  const own = paths.host(host)
  mkdirSync(own.dir, { recursive: true })
  return own
}

export function dayFileName(date = new Date()) {
  return `${date.toISOString().slice(0, 10)}.jsonl`
}
