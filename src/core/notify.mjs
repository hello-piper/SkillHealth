/**
 * Copy and delivery for the three reminder channels. All three share one
 * message; restraint is enforced by the health service before this module runs.
 */
import { execFile } from 'node:child_process'

const RULE_ORDER = ['never_used', 'stale', 'duplicate', 'missing_path', 'high_failure', 'trigger_conflict']

const ZH = {
  title: '技能库该整理了',
  bannerTitle: '技能该整理了',
  health: '健康分',
  archiveUnit: '个技能可归档',
  issueUnit: '个技能',
  pending: '待整理',
  ruleUnit: '条规则命中',
  unused: '未用',
  duplicate: '重复',
  missing: '失效',
  failure: '失败',
  conflict: '误路由',
  tokens: '每次启动多注入',
  tokensUnit: 'tokens',
  command: '/skillhealth',
  service: 'SkillHealth',
  inspect: '查看建议',
  ignore: '本周忽略',
  close: '关闭',
  recovered: '已恢复：健康分回到 80 以上，提醒已停止。',
  weekly: '本周技能用量周报',
  calls: '调用',
  skills: '技能',
  times: '次',
  top: 'Top',
  scoreDelta: '健康分',
  detailRules: '条规则命中',
  actions: {
    archive: '归档',
    merge: '合并',
    fix: '修复 / 删除',
    investigate: '排查',
    rewrite: '改描述',
  },
}

const EN = {
  title: 'Skill library needs tidying',
  bannerTitle: 'Skills need tidying',
  health: 'Health',
  archiveUnit: 'skills can be archived',
  issueUnit: 'skills',
  pending: ' need tidying',
  ruleUnit: 'rules matched',
  unused: 'unused',
  duplicate: 'duplicate',
  missing: 'broken',
  failure: 'failing',
  conflict: 'misrouted',
  tokens: 'injected at startup',
  tokensUnit: 'tokens',
  command: '/skillhealth',
  service: 'SkillHealth',
  inspect: 'View advice',
  ignore: 'Ignore this week',
  close: 'Close',
  recovered: 'Recovered: health is back above 80, reminders stopped.',
  weekly: 'Weekly skill usage',
  calls: 'calls',
  skills: 'skills',
  times: '',
  top: 'Top',
  scoreDelta: 'Health',
  detailRules: 'rules matched',
  actions: {
    archive: 'Archive',
    merge: 'Merge',
    fix: 'Fix / delete',
    investigate: 'Investigate',
    rewrite: 'Rewrite description',
  },
}

export function dictionaries(locale = 'zh') {
  return locale === 'en' ? { zh: ZH, en: EN } : { zh: ZH, en: EN }
}

export function formatTokens(value) {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 1000) {
    const thousands = value / 1000
    return `${thousands >= 10 ? Math.round(thousands) : Math.round(thousands * 10) / 10}k`
  }
  return String(Math.round(value))
}

export function uniqueIssueSkills(issues) {
  return new Set(issues.map((issue) => issue.skill))
}

/** Build the single message all three channels reuse. */
export function formatReminder(health, { locale = 'zh' } = {}) {
  const dict = locale === 'en' ? EN : ZH
  const byRule = health.byRule ?? {}
  const unused = (byRule.never_used ?? 0) + (byRule.stale ?? 0)
  const parts = []
  if (unused) parts.push(`${unused} ${dict.unused}`)
  if (byRule.duplicate) parts.push(`${byRule.duplicate} ${dict.duplicate}`)
  if (byRule.missing_path) parts.push(`${byRule.missing_path} ${dict.missing}`)
  if (byRule.high_failure) parts.push(`${byRule.high_failure} ${dict.failure}`)
  if (byRule.trigger_conflict) parts.push(`${byRule.trigger_conflict} ${dict.conflict}`)

  const skills = uniqueIssueSkills(health.issues ?? []).size
  const ruleCount = RULE_ORDER.filter((rule) => (byRule[rule] ?? 0) > 0).length
  const tokens = formatTokens(health.tokensWasted ?? 0)
  const detail = parts.join(' / ')

  const terminal = `⚠ ${dict.service}：${skills} ${dict.issueUnit}${dict.pending}` +
    (detail ? `（${detail}）` : '') +
    `，${dict.tokens} ${tokens} ${dict.tokensUnit} · ${dict.command}`

  return {
    terminal,
    inspect: dict.inspect,
    ignore: dict.ignore,
    close: dict.close,
    notification: {
      title: dict.title,
      subtitle: `${dict.health} ${health.score}，${health.archiveSkills?.length ?? 0} ${dict.archiveUnit}`,
    },
    banner: {
      title: dict.bannerTitle,
      detail: locale === 'en'
        ? `${ruleCount} ${ruleCount === 1 ? 'rule' : 'rules'} matched ${skills} ${skills === 1 ? 'skill' : 'skills'}`
        : `${ruleCount} ${dict.detailRules} ${skills} ${dict.issueUnit}`,
      score: health.score,
      skills,
      ruleCount,
      tokensWasted: health.tokensWasted ?? 0,
    },
  }
}

export function issueText(issue, locale = 'zh') {
  const dict = locale === 'en' ? EN : ZH
  switch (issue.rule) {
    case 'never_used':
      return locale === 'en' ? `Never used (installed ${issue.days} days ago)` : `从未使用（安装 ${issue.days} 天）`
    case 'stale':
      return locale === 'en' ? `${issue.days} days idle (${issue.calls} calls)` : `${issue.days} 天未用（累计 ${issue.calls} 次）`
    case 'duplicate':
      return locale === 'en'
        ? `Description similarity ${issue.similarity} with ${issue.peer}`
        : `与 ${issue.peer} 描述相似度 ${issue.similarity}`
    case 'missing_path':
      return locale === 'en'
        ? `Path or dependency missing${issue.path ? `: ${issue.path}` : ''}`
        : `路径或依赖失效${issue.path ? `：${issue.path}` : ''}`
    case 'high_failure':
      return locale === 'en'
        ? `${issue.calls} calls, ${Math.round(issue.rate * 100)}% failing`
        : `${issue.calls} 次调用，失败率 ${Math.round(issue.rate * 100)}%`
    case 'trigger_conflict':
      return locale === 'en'
        ? `Keyword overlap ${issue.overlap} with ${issue.peer}, ${issue.count} shared sessions`
        : `与 ${issue.peer} 关键词重叠 ${issue.overlap}，同会话共现 ${issue.count} 次`
    default:
      return issue.rule
  }
}

export function actionText(action, locale = 'zh') {
  const dict = locale === 'en' ? EN : ZH
  return dict.actions[action] ?? action
}

export function ruleLabel(rule, locale = 'zh') {
  const dict = locale === 'en' ? EN : ZH
  return {
    never_used: dict.unused,
    stale: dict.unused,
    duplicate: dict.duplicate,
    missing_path: dict.missing,
    high_failure: dict.failure,
    trigger_conflict: dict.conflict,
  }[rule] ?? rule
}

export function weeklyReport({ health, daily = [], previousScore = null, recovered = null, locale = 'zh' }) {
  const dict = locale === 'en' ? EN : ZH
  const calls = daily.reduce((sum, row) => sum + row.calls, 0)
  const ok = daily.reduce((sum, row) => sum + row.ok, 0)
  const skillSet = new Set(daily.map((row) => row.skill))
  const bySkill = new Map()
  for (const row of daily) bySkill.set(row.skill, (bySkill.get(row.skill) ?? 0) + row.calls)
  const top = [...bySkill.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const delta = previousScore === null ? null : health.score - previousScore

  const lines = [
    `📊 ${dict.weekly}`,
    `${dict.calls} ${calls} · ${dict.skills} ${skillSet.size} · ok ${ok}/${calls}`,
  ]
  if (top.length) lines.push(`${dict.top}: ${top.map(([name, count]) => `${name} (${count})`).join(', ')}`)
  lines.push(`${dict.scoreDelta} ${health.score}${delta === null ? '' : ` (${delta >= 0 ? '+' : ''}${delta})`}`)
  if (recovered) lines.push(`✅ ${dict.recovered}`)
  return lines.join('\n')
}

/** Best-effort native notification. Never throws into the caller. */
export function sendSystemNotification({ title, subtitle }, { logger = () => {} } = {}) {
  try {
    if (process.platform === 'darwin') {
      const script = `display notification ${quoteApple(subtitle)} with title ${quoteApple(title)}`
      execFile('osascript', ['-e', script], { timeout: 3000 }, (error) => {
        if (error) logger('warn', 'system notification failed', error.message)
      })
      return true
    }
    if (process.platform === 'linux') {
      execFile('notify-send', [title, subtitle], { timeout: 3000 }, (error) => {
        if (error) logger('warn', 'system notification failed', error.message)
      })
      return true
    }
    return false
  } catch (error) {
    logger('warn', 'system notification threw', error.message)
    return false
  }
}

function quoteApple(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}
