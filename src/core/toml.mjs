/**
 * Minimal TOML reader/writer for the per-host `config.toml`. Only the shapes
 * this plugin writes are supported: sections, scalars, and arrays of scalars.
 */

export function parseToml(text) {
  const root = {}
  let section = root
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = stripComment(rawLine).trim()
    if (!line) continue
    const header = /^\[([^\]]+)\]$/.exec(line)
    if (header) {
      section = root
      for (const part of header[1].split('.').map((value) => value.trim()).filter(Boolean)) {
        if (typeof section[part] !== 'object' || section[part] === null) section[part] = {}
        section = section[part]
      }
      continue
    }
    const separator = line.indexOf('=')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    section[key] = parseValue(line.slice(separator + 1).trim())
  }
  return root
}

function stripComment(line) {
  let quote = null
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quote) {
      if (char === '\\') index += 1
      else if (char === quote) quote = null
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '#') {
      return line.slice(0, index)
    }
  }
  return line
}

function parseValue(raw) {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw.startsWith('"') && raw.endsWith('"')) return unescapeString(raw.slice(1, -1))
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1)
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return raw.slice(1, -1)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map(parseValue)
  }
  const number = Number(raw)
  return Number.isFinite(number) ? number : raw
}

function unescapeString(value) {
  return value.replace(/\\(["\\ntr])/g, (_, char) => {
    if (char === 'n') return '\n'
    if (char === 't') return '\t'
    if (char === 'r') return '\r'
    return char
  })
}

export function stringifyToml(value) {
  const lines = []
  const sections = []
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) sections.push([key, entry])
    else lines.push(`${key} = ${formatValue(entry)}`)
  }
  for (const [name, entry] of sections) {
    lines.push('', `[${name}]`)
    for (const [key, item] of Object.entries(entry)) lines.push(`${key} = ${formatValue(item)}`)
  }
  return `${lines.join('\n')}\n`
}

function formatValue(value) {
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(formatValue).join(', ')}]`
  return String(value)
}

export function deepMerge(base, override) {
  const out = Array.isArray(base) ? [...base] : { ...base }
  for (const [key, value] of Object.entries(override ?? {})) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && typeof out[key] === 'object' && !Array.isArray(out[key])) {
      out[key] = deepMerge(out[key] ?? {}, value)
    } else {
      out[key] = value
    }
  }
  return out
}
