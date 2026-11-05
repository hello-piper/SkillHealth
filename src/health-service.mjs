/**
 * Health orchestration: rebuild, scan, persist per-host snapshots, decide
 * whether a reminder is due, and settle user actions on the reminder.
 */
import { existsSync } from 'node:fs'
import { analyzeHealth, activeIssues, reminderDue } from './core/health.mjs'
import {
  actionText,
  dictionaries,
  formatReminder,
  issueText,
  ruleLabel,
  sendSystemNotification,
  weeklyReport,
} from './core/notify.mjs'
import { percentile } from './core/rollup.mjs'
import { readDaily, readHealthSnapshots, recordHealth } from './store/sqlite.mjs'
import { readJson, writeJson } from './store/files.mjs'

const DAY = 86_400_000
const STALE_SCAN_MS = 10 * 60 * 1000

const DEFAULT_NOTIFY = Object.freeze({
  enabled: true,
  silencedUntil: null,
  disabledRules: [],
  remindedSessions: [],
  lastNotifiedAt: null,
  lastSystemAt: null,
  wasReminded: false,
  recovered: null,
  updatedAt: null,
})

export function createHealthService({ paths, host, config, collector, catalog, logger = () => {} }) {
  const own = paths.host(host)
  let cache = null
  let running = null

  function readNotify() {
    return { ...DEFAULT_NOTIFY, ...readJson(own.notify, {}) }
  }

  function writeNotify(value) {
    writeJson(own.notify, { ...value, updatedAt: new Date().toISOString() })
  }

  function readHealthState() {
    return readJson(own.healthState, { lastScanAt: null, lastScanDay: null, lastScore: null, previousScore: null })
  }

  async function scan(reason = 'manual') {
    const skills = await catalog()
    const data = collector.rebuild(skills)
    // Disabled skills are intentionally absent from the model catalog, so they
    // must not lower the score or appear as tidy-up work.
    const disabledNames = new Set(skills.filter((skill) => skill.disabled).map((skill) => skill.name))
    const activeSkills = skills.filter((skill) => !skill.disabled)
    const activeCalls = data.calls.filter((call) => !disabledNames.has(call.skill))
    const activeCooccur = data.cooccur.filter((row) => !disabledNames.has(row.skill_a) && !disabledNames.has(row.skill_b))
    const health = analyzeHealth({
      skills: activeSkills,
      calls: activeCalls,
      cooccur: activeCooccur,
      config: config.health,
    })
    const snapshot = {
      agent: host,
      scanned_at: health.generatedAt,
      score: health.score,
      dimensions: health.dimensions,
      issues: health.issues,
      byRule: health.byRule,
      archiveSkills: health.archiveSkills,
      duplicateSkills: health.duplicateSkills,
      tokensWasted: health.tokensWasted,
      totals: health.totals,
    }
    writeJson(own.health, snapshot)
    try {
      recordHealth(paths.rollupDb, {
        scanned_at: health.generatedAt,
        agent: host,
        score: health.score,
        usage_score: health.dimensions.usage,
        success_score: health.dimensions.success,
        freshness_score: health.dimensions.freshness,
        redundancy_score: health.dimensions.redundancy,
        issues_count: health.issues.length,
        issues_json: JSON.stringify(health.issues),
      })
    } catch (error) {
      // health.json above is authoritative for the banner; history is best-effort.
      logger('warn', 'health snapshot write failed', error instanceof Error ? error.message : String(error))
    }

    const state = readHealthState()
    const nextState = {
      ...state,
      lastScanAt: health.generatedAt,
      lastScanDay: health.generatedAt.slice(0, 10),
      lastRebuildAt: data.builtAt,
      lastCalls: data.calls.length,
      lastEvents: data.events.length,
      previousScore: state.lastScore,
      lastScore: health.score,
      lastReason: reason,
    }
    writeJson(own.healthState, nextState)

    const notify = readNotify()
    if (notify.wasReminded && health.score >= (config.health.score_recover_above ?? 80)) {
      notify.recovered = { at: health.generatedAt, score: health.score }
      notify.wasReminded = false
      writeNotify(notify)
    }

    cache = { health, skills, activeSkills, data, at: Date.now() }
    return cache
  }

  async function ensure({ maxAgeMs = STALE_SCAN_MS, force = false } = {}) {
    if (running) return running
    const stale = !cache || force || Date.now() - cache.at > maxAgeMs ||
      (collector.builtAt() !== null && collector.builtAt() !== cache.data?.builtAt)
    if (!stale) return cache
    running = scan('refresh').finally(() => { running = null })
    return running
  }

  function visible(list) {
    const notify = readNotify()
    const active = activeIssues(list.issues, notify.disabledRules)
    const byRule = {}
    for (const issue of active) byRule[issue.rule] = (byRule[issue.rule] ?? 0) + 1
    const names = new Set(active.map((issue) => issue.skill))
    return {
      ...list,
      issues: active,
      byRule,
      tokensWasted: cache?.skills?.filter((skill) => names.has(skill.name))
        .reduce((sum, skill) => sum + (skill.tokens_est ?? 0), 0) ?? 0,
    }
  }

  function dueNow(health, notify) {
    if (!config.notify.enabled) return false
    return reminderDue(health, config.health, { ...notify, enabled: true })
  }

  function dominantRule(issues) {
    const counts = new Map()
    for (const issue of issues) counts.set(issue.rule, (counts.get(issue.rule) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'never_used'
  }

  function reminderPayload(health, due, issueList) {
    const zh = formatReminder(health, { locale: 'zh' })
    const en = formatReminder(health, { locale: 'en' })
    return {
      due,
      dominantRule: dominantRule(issueList),
      zh: { due, ...zh, banner: { ...zh.banner, rule: dominantRule(issueList) } },
      en: { due, ...en, banner: { ...en.banner, rule: dominantRule(issueList) } },
    }
  }

  function decorate(issue) {
    return {
      ...issue,
      text_zh: issueText(issue, 'zh'),
      text_en: issueText(issue, 'en'),
      action_zh: actionText(issue.action, 'zh'),
      action_en: actionText(issue.action, 'en'),
      rule_zh: ruleLabel(issue.rule, 'zh'),
      rule_en: ruleLabel(issue.rule, 'en'),
    }
  }

  function suggestions(healthIssues) {
    const byName = new Map(cache.skills.map((skill) => [skill.name, skill]))
    const unique = new Map()
    for (const issue of healthIssues) {
      if (unique.has(issue.skill)) continue
      const meta = byName.get(issue.skill)
      unique.set(issue.skill, {
        ...decorate(issue),
        tokens_est: meta?.tokens_est ?? 0,
        editable: meta?.editable !== false,
      })
    }
    return [...unique.values()]
      .sort((left, right) => right.tokens_est - left.tokens_est)
      .slice(0, 3)
  }

  function stateFor(sessionId) {
    const notify = readNotify()
    const activeHealth = visible(cache.health)
    const bannerEnabled = config.notify.banner !== false
    const due = bannerEnabled && dueNow(activeHealth, notify)
    const reminder = reminderPayload(activeHealth, due, activeHealth.issues)
    const issues = activeHealth.issues.slice(0, 100).map(decorate)
    return {
      host,
      sessionId: sessionId ?? null,
      generatedAt: cache.health.generatedAt,
      score: cache.health.score,
      dimensions: cache.health.dimensions,
      totals: cache.health.totals,
      tokensWasted: activeHealth.tokensWasted,
      archiveCount: uniqueArchiveCount(activeHealth.issues),
      issues,
      suggestions: suggestions(activeHealth.issues),
      disabledSkills: cache.skills.filter((skill) => skill.disabled).map((skill) => skill.name),
      byRule: activeHealth.byRule,
      reminder: due ? reminder.zh : null,
      reminderI18n: { zh: reminder.zh, en: reminder.en },
      silencedUntil: notify.silencedUntil,
      disabledRules: notify.disabledRules ?? [],
      weekly: buildWeekly(),
      i18n: dictionaries('zh'),
    }
  }

  function uniqueArchiveCount(issues) {
    return new Set(issues.filter((issue) => issue.rule === 'never_used' || issue.rule === 'stale')
      .map((issue) => issue.skill)).size
  }

  async function getState({ sessionId } = {}) {
    await ensure()
    return stateFor(sessionId)
  }

  /** Full management payload: every catalog skill, stats, trend, issues. */
  async function manage() {
    // Management is the view that must reflect upstream SKILL.md edits, so it
    // pays for a fresh catalog instead of trusting the reminder cache.
    await ensure({ force: true })
    const calls = cache.data.calls
    const stats = new Map()
    for (const call of calls) {
      if (!['ok', 'error', 'abort'].includes(call.status)) continue
      if (!stats.has(call.skill)) {
        stats.set(call.skill, {
          calls: 0, ok: 0, error: 0, abort: 0,
          first_used_at: call.started_at, last_used_at: call.ended_at ?? call.started_at,
          durations: [],
        })
      }
      const row = stats.get(call.skill)
      row.calls += 1
      row[call.status] += 1
      if (Date.parse(call.started_at) < Date.parse(row.first_used_at)) row.first_used_at = call.started_at
      const usedAt = call.ended_at ?? call.started_at
      if (Date.parse(usedAt) > Date.parse(row.last_used_at)) row.last_used_at = usedAt
      if (Number.isFinite(call.duration_ms)) row.durations.push(call.duration_ms)
    }

    const issueBySkill = new Map()
    for (const issue of cache.health.issues) {
      if (!issueBySkill.has(issue.skill)) issueBySkill.set(issue.skill, [])
      issueBySkill.get(issue.skill).push(decorate(issue))
    }

    const skills = cache.skills.map((skill) => {
      const row = stats.get(skill.name)
      const durations = row?.durations ?? []
      return {
        name: skill.name,
        description: skill.description ?? '',
        description_fingerprint: skill.description_fingerprint ?? null,
        category: skill.category ?? null,
        source: skill.source ?? null,
        path: skill.path ?? null,
        install_path: skill.install_path ?? null,
        installed_at: skill.installed_at ?? null,
        tokens_est: skill.tokens_est ?? 0,
        enabled: !skill.disabled,
        editable: skill.editable !== false,
        model_invocable: skill.model_invocable !== false,
        calls: row?.calls ?? 0,
        ok: row?.ok ?? 0,
        error: row?.error ?? 0,
        abort: row?.abort ?? 0,
        success_rate: row?.calls ? Math.round((row.ok / row.calls) * 100) : null,
        first_used_at: row?.first_used_at ?? null,
        last_used_at: row?.last_used_at ?? null,
        p50_ms: percentile(durations, 50),
        p95_ms: percentile(durations, 95),
        issues: issueBySkill.get(skill.name) ?? [],
      }
    }).sort((left, right) => Number(right.enabled) - Number(left.enabled) || right.calls - left.calls || left.name.localeCompare(right.name))

    const since = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10)
    const daily = readDaily(paths.rollupDb, since)
    const trendMap = new Map()
    for (const row of daily) {
      if (!trendMap.has(row.day)) trendMap.set(row.day, { day: row.day, calls: 0, ok: 0, error: 0, abort: 0 })
      const day = trendMap.get(row.day)
      day.calls += row.calls
      day.ok += row.ok
      day.error += row.error
      day.abort += row.abort
    }

    return {
      host,
      generatedAt: cache.health.generatedAt,
      score: cache.health.score,
      dimensions: cache.health.dimensions,
      totals: cache.health.totals,
      tokensWasted: cache.health.tokensWasted,
      archiveCount: cache.health.archiveSkills.length,
      disabledSkills: cache.skills.filter((skill) => skill.disabled).map((skill) => skill.name),
      silencedUntil: readNotify().silencedUntil,
      disabledRules: readNotify().disabledRules ?? [],
      skills,
      daily: [...trendMap.values()].sort((left, right) => left.day.localeCompare(right.day)),
      issues: cache.health.issues.map(decorate),
      byRule: cache.health.byRule,
      weekly: buildWeekly(),
      settings: { health: config.health, notify: config.notify },
    }
  }

  /** Terminal line + native notification, at most once per Session. */
  async function remindTerminal(sessionId) {
    if (!config.notify.enabled || config.notify.terminal === false) return null
    try {
      const notify = readNotify()
      if ((notify.remindedSessions ?? []).includes(sessionId)) return null
      await ensure({ maxAgeMs: 5 * 60 * 1000 })
      const activeHealth = visible(cache.health)
      if (!dueNow(activeHealth, notify)) return null
      const message = formatReminder(activeHealth, { locale: 'zh' })
      const now = new Date()
      let systemSent = false
      const cooldown = (config.notify.cooldown_hours ?? 24) * 3_600_000
      if (config.notify.system !== false && (!notify.lastSystemAt || now.getTime() - Date.parse(notify.lastSystemAt) > cooldown)) {
        systemSent = sendSystemNotification(message.notification, { logger })
      }
      writeNotify({
        ...notify,
        remindedSessions: [...(notify.remindedSessions ?? []), sessionId].slice(-200),
        lastNotifiedAt: now.toISOString(),
        lastSystemAt: systemSent ? now.toISOString() : notify.lastSystemAt,
        wasReminded: true,
      })
      return message.terminal
    } catch (error) {
      logger('warn', 'terminal reminder failed', error instanceof Error ? error.message : String(error))
      return null
    }
  }

  async function act({ action, rule, sessionId } = {}) {
    const notify = readNotify()
    const now = new Date()
    if (action === 'ignore') {
      notify.silencedUntil = new Date(now.getTime() + (config.notify.ignore_days ?? 14) * DAY).toISOString()
    } else if (action === 'close' || action === 'dismiss') {
      const chosen = rule ?? dominantRule(visible(cache?.health ?? { issues: [] }).issues)
      const disabled = new Set(notify.disabledRules ?? [])
      disabled.add(chosen)
      notify.disabledRules = [...disabled]
    } else if (action === 'reset') {
      notify.silencedUntil = null
      notify.disabledRules = []
      notify.wasReminded = false
      notify.recovered = null
    } else if (action === 'refresh') {
      await ensure({ force: true })
      return { ok: true, state: stateFor(sessionId) }
    } else if (action === 'seen') {
      // Popup acknowledged without muting anything.
    } else {
      return { ok: false, reason: 'unknown-action' }
    }
    writeNotify(notify)
    await ensure({ force: true })
    return { ok: true, state: stateFor(sessionId) }
  }

  function buildWeekly() {
    const since = new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10)
    let daily = []
    let snapshots = []
    try {
      daily = readDaily(paths.rollupDb, since)
      snapshots = existsSync(paths.rollupDb) ? readHealthSnapshots(paths.rollupDb, 5) : []
    } catch (error) {
      logger('warn', 'weekly read failed', error instanceof Error ? error.message : String(error))
    }
    const previous = snapshots[1]?.score ?? readHealthState().previousScore ?? null
    const notify = readNotify()
    const recovered = notify.recovered && Date.parse(notify.recovered.at) > Date.now() - 7 * DAY
      ? notify.recovered
      : null
    return {
      text: weeklyReport({ health: cache.health, daily, previousScore: previous, recovered, locale: 'zh' }),
      text_en: weeklyReport({ health: cache.health, daily, previousScore: previous, recovered, locale: 'en' }),
      daily,
      recovered,
    }
  }

  async function weekly() {
    await ensure()
    return buildWeekly()
  }

  return {
    ensure,
    scan,
    getState,
    manage,
    remindTerminal,
    act,
    weekly,
    readNotify,
    writeNotify,
    paths: own,
  }
}
