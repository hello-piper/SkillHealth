/**
 * SkillHealth host half: captures the DSH `skill` tool, appends contract events,
 * rebuilds the shared index/rollup, and serves the health API used by the web
 * banner and the `/skillhealth` command.
 */
import { existsSync } from 'node:fs'
import { buildCatalog } from './src/catalog.mjs'
import { createCollector, ensureRoot } from './src/collector.mjs'
import { loadHostConfig } from './src/config.mjs'
import { expandHome, hashPrompt, messageText } from './src/core/privacy.mjs'
import { setDisableFlag } from './src/frontmatter.mjs'
import { createHealthService } from './src/health-service.mjs'
import { issueText, ruleLabel } from './src/core/notify.mjs'
import { DEFAULT_ROOT, expandRoot, layout } from './src/store/paths.mjs'
import { readJson, writeJson } from './src/store/files.mjs'
import { createDshAdapter, HOOK_VERSION } from './src/adapters/dsh.mjs'

export const name = 'skilltrace'
export const inject = ['tools', 'skills']

const HOST = 'dsh'
const API_STATE = '/skill-usage-stats/api/state'
const API_ACTION = '/skill-usage-stats/api/action'
const API_WEEKLY = '/skill-usage-stats/api/weekly'
const API_MANAGE = '/skill-usage-stats/api/manage'
const API_SKILLS = '/skill-usage-stats/api/skills'

export function apply(ctx, patchConfig = {}) {
  const root = expandRoot(patchConfig.root ?? DEFAULT_ROOT)
  const paths = layout(root)
  ensureRoot(root, HOST)
  const config = loadHostConfig({
    paths,
    host: HOST,
    overrides: { notify: patchConfig.notify ?? {} },
  })
  const own = paths.host(HOST)
  const adapter = createDshAdapter({ agentVersion: patchConfig.agent_version })
  if (!existsSync(own.notify)) {
    writeJson(own.notify, {
      enabled: true,
      silencedUntil: null,
      disabledRules: [],
      remindedSessions: [],
      lastNotifiedAt: null,
      lastSystemAt: null,
      wasReminded: false,
      recovered: null,
    })
  }
  if (!existsSync(own.healthState)) {
    writeJson(own.healthState, {
      lastScanAt: null,
      lastScanDay: null,
      lastScore: null,
      previousScore: null,
    })
  }
  const previousInstall = readJson(own.install, {})
  writeJson(own.install, {
    host: HOST,
    adapter: adapter.id,
    hookVersion: HOOK_VERSION,
    pluginVersion: '1.2.0',
    schema: 'skill-usage/1',
    installedAt: previousInstall.installedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    root,
    registration: {
      capture: 'tools/execute around the skill tool',
      events: ['tools/execute', 'agent/inbox/claimed', 'agent/pre-step'],
      routes: [API_STATE, API_ACTION, API_WEEKLY, API_MANAGE, API_SKILLS],
      command: '/skillhealth',
    },
  })

  const collector = createCollector({ root, host: HOST, adapter, config })
  const promptHashes = new Map()
  let catalogAgent = undefined
  let lastCatalog = []

  function cwdOf(agent) {
    try {
      const working = ctx.get('workingDirectory')
      if (working && agent?.session) return working.get(agent.session)
    } catch {
      // Fall through to the process directory.
    }
    return process.cwd()
  }

  async function catalog() {
    const agents = ctx.get('agents')
    const agent = catalogAgent ?? agents?.currentInitiator?.() ?? agents?.roots?.()[0] ?? agents?.list?.()[0]
    const working = ctx.get('workingDirectory')
    const cwd = agent ? cwdOf(agent) : working?.defaultDirectory
    const options = { ...(agent ? { scope: agent } : {}), ...(cwd ? { cwd } : {}) }
    // The initial scan can race providers registering during boot; snapshot
    // reports completeness, so retry briefly instead of caching an empty list.
    let snapshot = await ctx.skills.snapshot(options)
    for (let attempt = 0; attempt < 6 && (!snapshot.complete || (snapshot.skills ?? []).length === 0); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 400))
      snapshot = await ctx.skills.snapshot(options)
    }
    const summaries = snapshot.skills ?? []
    lastCatalog = buildCatalog(summaries)
    return lastCatalog
  }

  /**
   * Toggle the standard `disable-model-invocation` field in SKILL.md. The
   * frontmatter is the source of truth, so a page refresh always reads the
   * current file state even after an upstream update.
   */
  async function setSkillInvocation(name, enabled) {
    let entry = lastCatalog.find((skill) => skill.name === name)
    if (!entry) {
      await catalog()
      entry = lastCatalog.find((skill) => skill.name === name)
    }
    if (!entry) return { ok: false, reason: 'skill-not-found', skill: name }
    if (!entry.editable || !entry.path) {
      return { ok: false, reason: 'path-unavailable', skill: name }
    }
    try {
      setDisableFlag(expandHome(entry.path), !enabled)
    } catch (error) {
      return {
        ok: false,
        reason: 'write-failed',
        skill: name,
        message: error instanceof Error ? error.message : String(error),
      }
    }
    await catalog()
    await health.ensure({ force: true })
    collector.log('info', enabled ? 'skill enabled' : 'skill disabled', { skill: name, file: entry.path })
    return { ok: true, skill: name }
  }

  const health = createHealthService({
    paths,
    host: HOST,
    config,
    collector,
    catalog,
    logger: (level, message, detail) => collector.log(level, message, detail),
  })

  // Capture: one durable start/end pair around the real dispatch, so duration
  // is measured here rather than reconstructed on the next session boot.
  ctx.effect(() => ctx.on('tools/execute', async (exec, next) => {
    if (!exec || exec.name !== 'skill') return next()
    if (exec.agent) catalogAgent = exec.agent
    const startedAt = Date.now()
    const capture = {
      sessionId: exec.agent?.id,
      cwd: cwdOf(exec.agent),
      promptHash: exec.agent ? promptHashes.get(exec.agent.id) : undefined,
    }
    collector.start(exec, capture)
    try {
      const result = await next()
      collector.end(exec, result, {
        ...capture,
        durationMs: Math.max(0, Date.now() - startedAt),
        protocolAbort: exec.signal?.aborted === true,
      })
      return result
    } catch (error) {
      collector.end(exec, { isError: true, error: { name: 'thrown', message: String(error) } }, {
        ...capture,
        durationMs: Math.max(0, Date.now() - startedAt),
      })
      throw error
    }
  }), 'skill-usage-stats: capture skill tool')

  // Prompt fingerprint only; the message body never leaves this callback.
  ctx.effect(() => ctx.on('agent/inbox/claimed', (payload) => {
    try {
      const text = messageText(payload?.message)
      if (text && payload?.agent?.id) promptHashes.set(payload.agent.id, hashPrompt(text))
    } catch (error) {
      collector.log('warn', 'prompt hash failed', error instanceof Error ? error.message : String(error))
    }
  }), 'skill-usage-stats: prompt fingerprint')

  ctx.effect(() => ctx.on('agent/disposed', (payload) => {
    if (payload?.agent?.id) promptHashes.delete(payload.agent.id)
  }), 'skill-usage-stats: per-agent cleanup')

  // Terminal + native notification, once per Session, never in the model context.
  ctx.effect(() => ctx.on('agent/pre-step', (payload, next) => {
    if (payload?.turn === 1 && payload?.agent?.id) {
      const sessionId = payload.agent.id
      catalogAgent = payload.agent
      void health.remindTerminal(sessionId).then((line) => {
        if (line) process.stderr.write(`${line}\n`)
      }).catch((error) => collector.log('warn', 'terminal reminder failed',
        error instanceof Error ? error.message : String(error)))
    }
    return next()
  }), 'skill-usage-stats: first-turn reminder')

  // Human command: prints the same snapshot the banner reads.
  const commands = ctx.get('commands')
  if (commands) {
    ctx.effect(() => commands.register({
      name: 'skillhealth',
      description: 'SkillHealth: show skill usage health and the archived/duplicate suggestions.',
      handler: async (invocation) => {
        try {
          catalogAgent = invocation.agent
          const state = await health.getState({ sessionId: invocation.agent?.id })
          return { kind: 'success', text: healthText(state) }
        } catch (error) {
          return { kind: 'error', text: `SkillHealth: ${error instanceof Error ? error.message : String(error)}` }
        }
      },
    }), 'skillhealth: command')
  }

  // Browser API for the banner. `host.call` is not available to bundle Client
  // halves, so the Client fetches these same-origin routes instead.
  const webServer = ctx.get('webServer')
  if (webServer) {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: API_STATE,
      handler: async (req, res) => {
        if (reject(ctx, req, res)) return
        if (req.method !== 'GET') return methodNotAllowed(res, 'GET')
        try {
          const url = new URL(String(req.url), 'http://localhost')
          const state = await health.getState({ sessionId: url.searchParams.get('session') ?? undefined })
          sendJson(res, 200, state)
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }), `skill-usage-stats: GET ${API_STATE}`)

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: API_ACTION,
      handler: async (req, res) => {
        if (reject(ctx, req, res)) return
        if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
        try {
          const body = await readJsonBody(req)
          const result = await health.act({
            action: body?.action,
            rule: body?.rule,
            sessionId: body?.session,
          })
          sendJson(res, result.ok ? 200 : 400, result)
        } catch (error) {
          sendJson(res, 400, { ok: false, reason: error instanceof Error ? error.message : String(error) })
        }
      },
    }), `skill-usage-stats: POST ${API_ACTION}`)

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: API_WEEKLY,
      handler: async (req, res) => {
        if (reject(ctx, req, res)) return
        if (req.method !== 'GET') return methodNotAllowed(res, 'GET')
        try {
          sendJson(res, 200, await health.weekly())
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }), `skill-usage-stats: GET ${API_WEEKLY}`)

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: API_MANAGE,
      handler: async (req, res) => {
        if (reject(ctx, req, res)) return
        if (req.method !== 'GET') return methodNotAllowed(res, 'GET')
        try {
          const url = new URL(String(req.url), 'http://localhost')
          if (url.searchParams.get('refresh') === '1') await health.ensure({ force: true })
          sendJson(res, 200, await health.manage())
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }), `skill-usage-stats: GET ${API_MANAGE}`)

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: API_SKILLS,
      handler: async (req, res) => {
        if (reject(ctx, req, res)) return
        if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
        try {
          const body = await readJsonBody(req)
          const names = Array.isArray(body?.skills)
            ? body.skills
            : typeof body?.skill === 'string' ? [body.skill] : []
          if (names.length === 0) {
            sendJson(res, 400, { ok: false, reason: 'skills-required' })
            return
          }
          const enabled = body?.enabled === true
          const results = []
          for (const name of names) {
            if (typeof name !== 'string' || name === '') continue
            results.push(await setSkillInvocation(name, enabled))
          }
          const errors = results.filter((result) => !result.ok)
          sendJson(res, 200, {
            ok: errors.length === 0,
            errors,
            manage: await health.manage(),
            state: await health.getState({ sessionId: body?.session }),
          })
        } catch (error) {
          sendJson(res, 400, { ok: false, reason: error instanceof Error ? error.message : String(error) })
        }
      },
    }), `skill-usage-stats: POST ${API_SKILLS}`)
  }

  // Initial scan is background and deliberately delayed: sibling skill
  // providers register during boot, and a snapshot taken too early is complete
  // but empty. Activation must never wait on discovery.
  setTimeout(() => {
    void health.ensure({ force: true }).catch((error) => {
      collector.log('warn', 'initial scan failed', error instanceof Error ? error.message : String(error))
    })
  }, 2500)

  ctx.effect(() => () => collector.dispose(), 'skillhealth: dispose collector')
}

function healthText(state) {
  const dims = state.dimensions
  const lines = [
    `SkillHealth 健康分 ${state.score}（覆盖 ${dims.usage} / 成功 ${dims.success} / 新鲜 ${dims.freshness} / 冗余 ${dims.redundancy}）`,
    `技能 ${state.totals.skills} · 调用 ${state.totals.calls} · 建议整理 ${state.archiveCount} · 估算冗余注入 ${Math.round(state.tokensWasted / 100) / 10}k tokens`,
  ]
  const rules = Object.entries(state.byRule ?? {}).filter(([, count]) => count > 0)
  if (rules.length) lines.push(`规则：${rules.map(([rule, count]) => `${ruleLabel(rule, 'zh')} ${count}`).join(' · ')}`)
  const issues = (state.issues ?? []).slice(0, 15)
  if (issues.length) {
    lines.push('建议：')
    for (const issue of issues) lines.push(`- [${issue.action_zh}] ${issue.skill} — ${issueText(issue, 'zh')}`)
  }
  if (state.weekly?.text) lines.push('', state.weekly.text)
  return lines.join('\n')
}

function reject(ctx, req, res) {
  const connection = ctx.get('connection')
  if (!connection) return false
  try {
    const rejection = connection.requestRejection?.(req)
    if (rejection === undefined || rejection === null) return false
    res.statusCode = rejection
    res.end()
    return true
  } catch {
    // The admission service exists but could not decide: fail closed.
    res.statusCode = 401
    res.end()
    return true
  }
}

function sendJson(res, status, value) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

function methodNotAllowed(res, allow) {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.end()
}

function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, rejectPromise) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        rejectPromise(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text ? JSON.parse(text) : {})
      } catch (error) {
        rejectPromise(error)
      }
    })
    req.on('error', rejectPromise)
  })
}
