/**
 * Per-host configuration: defaults, the host's own `config.toml`, and the
 * row's patch config, in that precedence order.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { DEFAULT_CONFIG, ensureLayout } from './store/paths.mjs'
import { deepMerge, parseToml, stringifyToml } from './core/toml.mjs'

export function loadHostConfig({ paths, host, overrides = {} }) {
  const own = ensureLayout(paths, host)
  if (!existsSync(own.config)) writeFileSync(own.config, stringifyToml(DEFAULT_CONFIG), 'utf8')
  let fileConfig = {}
  try {
    fileConfig = parseToml(readFileSync(own.config, 'utf8'))
  } catch {
    fileConfig = {}
  }
  return { ...deepMerge(deepMerge(DEFAULT_CONFIG, fileConfig), overrides), host }
}
