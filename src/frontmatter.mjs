/**
 * Read and write the Agent Skills `disable-model-invocation` frontmatter flag
 * without touching any other line of SKILL.md.
 *
 * DSH's filesystem provider parses this field natively; writing it is the
 * standard way to hide a skill from the model catalog while keeping it
 * available to an explicit `/name` gesture.
 */
import { chmodSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const FIELD = 'disable-model-invocation'

function splitFrontmatter(content) {
  const lines = content.split(/\r?\n/)
  if (lines[0] !== '---') return null
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---') return { lines, end: index }
  }
  return null
}

function parseBoolean(raw) {
  const value = String(raw ?? '').trim().replace(/^["']|["']$/g, '').replace(/\s+#.*$/, '').toLowerCase()
  if (['true', 'yes', 'on', '1'].includes(value)) return true
  if (['false', 'no', 'off', '0'].includes(value)) return false
  return undefined
}

/**
 * @param {string} path absolute SKILL.md path
 * @returns {boolean|null} true when disabled, false when explicitly/absent enabled, null when unreadable
 */
export function readDisableFlag(path) {
  try {
    const parsed = splitFrontmatter(readFileSync(path, 'utf8'))
    if (!parsed) return null
    for (const line of parsed.lines.slice(1, parsed.end)) {
      const match = new RegExp(`^${FIELD}\\s*:\\s*(.*)$`).exec(line)
      if (!match) continue
      const value = parseBoolean(match[1])
      return value === undefined ? null : value
    }
    return false
  } catch {
    return null
  }
}

/**
 * Set the flag in place, preserving every other byte and the file mode.
 * @param {string} path absolute SKILL.md path
 * @param {boolean} disabled
 */
export function setDisableFlag(path, disabled) {
  const target = realpathSync(path)
  const content = readFileSync(target, 'utf8')
  const parsed = splitFrontmatter(content)
  if (!parsed) throw new Error('SKILL.md has no YAML frontmatter')
  const { lines, end } = parsed
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const line = `${FIELD}: ${disabled ? 'true' : 'false'}`
  let found = false
  for (let index = 1; index < end; index += 1) {
    if (new RegExp(`^${FIELD}\\s*:`).test(lines[index])) {
      lines[index] = line
      found = true
      break
    }
  }
  if (!found) lines.splice(end, 0, line)
  const next = lines.join(eol)
  const temp = join(dirname(target), `.${process.pid}-${Date.now()}.skillmd.tmp`)
  writeFileSync(temp, next, 'utf8')
  try {
    chmodSync(temp, statSync(target).mode)
  } catch {
    // Mode preservation is best-effort.
  }
  renameSync(temp, target)
  return disabled
}
