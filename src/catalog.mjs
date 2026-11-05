/**
 * Build health input from the live skill catalog. Only metadata is kept:
 * path, description, source category, install time, and an estimated startup
 * token cost. Skill bodies never enter the event stream.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fingerprint } from './core/event.mjs'
import { expandHome, foldHome } from './core/privacy.mjs'
import { readDisableFlag } from './frontmatter.mjs'

const CATEGORIES = {
  'project-dsh': 'project',
  'project-agents': 'project',
  'user-dsh': 'user',
  'user-agents': 'user',
  runtime: 'runtime',
  bundled: 'bundled',
}

const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

export function categoryOf(source) {
  return CATEGORIES[source] ?? 'custom'
}

/**
 * @param {Array} summaries `ctx.skills.list()` output
 * @param {{now?: number, checkLinks?: boolean}} options
 */
export function buildCatalog(summaries = [], options = {}) {
  const now = options.now ?? Date.now()
  const skills = []
  for (const summary of summaries) {
    const path = typeof summary.path === 'string' ? summary.path : undefined
    let exists = null
    let installedAt = null
    let missing = []
    if (path) {
      exists = existsSync(path)
      if (exists) {
        try {
          const stat = statSync(path)
          installedAt = new Date(stat.birthtimeMs || stat.mtimeMs || now).toISOString()
        } catch {
          exists = false
        }
        if (options.checkLinks !== false) missing = missingDependencies(path)
      }
    }
    const description = summary.description ?? ''
    const tokens = Math.ceil((String(summary.name).length + description.length + (summary.whenToUse?.length ?? 0)) / 4)
    // Read the file directly so a page refresh reflects the current SKILL.md
    // even while the skill provider still serves a cached catalog.
    const fileDisabled = path && exists ? readDisableFlag(expandHome(path)) : null
    const modelInvocable = summary.invocation?.modelInvocable !== false
    skills.push({
      name: summary.name,
      description,
      description_fingerprint: fingerprint(description),
      category: categoryOf(summary.source),
      source: summary.source ?? 'custom',
      path: path ? foldHome(path) : null,
      install_path: path ? foldHome(dirname(path)) : null,
      exists,
      missing,
      installed_at: installedAt,
      tokens_est: tokens,
      model_invocable: modelInvocable,
      user_invocable: summary.invocation?.userInvocable !== false,
      file_disabled: fileDisabled,
      disabled: fileDisabled === true || !modelInvocable,
      editable: Boolean(path && exists),
    })
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

/** Relative Markdown links that no longer resolve, capped for readability. */
function missingDependencies(skillFile) {
  let content
  try {
    content = readFileSync(skillFile, 'utf8')
  } catch {
    return []
  }
  const base = dirname(skillFile)
  const missing = new Set()
  for (const match of content.matchAll(LINK)) {
    const target = match[1]
    if (!target || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue
    if (isAbsolute(target)) continue
    const clean = target.split('#')[0].split('?')[0]
    if (!clean) continue
    if (!existsSync(resolve(base, clean))) missing.add(target)
    if (missing.size >= 10) break
  }
  return [...missing]
}
