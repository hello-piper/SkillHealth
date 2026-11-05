/**
 * Privacy boundary: metadata only. cwd is folded, prompts are reduced to a
 * sha1 prefix, and nothing is ever sent off the machine.
 */
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

/** Fold the current user's home directory to `~` and normalize separators. */
export function foldHome(path, home = homedir()) {
  if (typeof path !== 'string' || path === '') return path
  let value = path.replace(/\\/g, '/')
  const homePosix = home.replace(/\\/g, '/').replace(/\/+$/, '')
  if (homePosix && (value === homePosix || value.startsWith(`${homePosix}/`))) {
    value = `~${value.slice(homePosix.length)}`
  } else if (/^[A-Za-z]:\/Users\/[^/]+/.test(value)) {
    // A Windows path collected on another drive form: keep only the user part private.
    value = value.replace(/^[A-Za-z]:\/Users\/[^/]+/, '~')
  }
  return value
}

/** Expand a folded path for local filesystem work (never persisted). */
export function expandHome(path, home = homedir()) {
  if (typeof path !== 'string') return path
  if (path === '~') return home
  if (path.startsWith('~/')) return resolve(home, path.slice(2))
  return resolve(path)
}

/** Prompt fingerprint: sha1, first 8 hex characters. Body is never stored. */
export function hashPrompt(text) {
  return createHash('sha1').update(String(text ?? '')).digest('hex').slice(0, 8)
}

/** Collapse a free-form error to a short code safe for aggregation. */
export function errorCode(error) {
  if (error === null || error === undefined) return undefined
  const raw = typeof error === 'string'
    ? error
    : error.info?.code ?? error.name ?? error.code ?? 'tool_error'
  const code = String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return (code || 'tool_error').slice(0, 64)
}

/** Extract the visible text of a user message without keeping the message. */
export function messageText(message) {
  if (!message || typeof message !== 'object') return ''
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}
