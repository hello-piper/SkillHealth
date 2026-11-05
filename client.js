window.__ModuleLoader__.load({
  id: 'dsh-skillhealth',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const API = '/skill-usage-stats/api'
    const POPUP_KEY = 'skilltrace.popup.v2'
    const POPUP_COOLDOWN_MS = 12 * 60 * 60 * 1000

    const TEXT = {
      zh: {
        app: 'SkillHealth',
        popupTitle: '技能库该整理了',
        popupMeta: (score) => `健康分 ${score}`,
        unused: (count) => `${count} 个未用`,
        tokens: (value) => `约 ${value} tokens`,
        noSuggestions: '暂时没有需要处理的技能',
        selected: (count) => `禁用所选${count ? `（${count}）` : ''}`,
        selectedDone: (count) => `已禁用 ${count} 个技能，后续会话不再默认加载`,
        viewDetails: '查看详情',
        ignoreWeek: '本周忽略',
        close: '关闭',
        loading: '正在读取…',
        failed: '读取失败',
        pageTitle: 'SkillHealth',
        pageSubtitle: '技能用量、默认加载与整理建议',
        refresh: '刷新',
        restore: '恢复提醒',
        health: '健康分',
        coverage: '覆盖',
        success: '成功',
        freshness: '新鲜',
        redundancy: '冗余',
        skills: '技能',
        enabledCount: (on, total) => `${on}/${total} 启用`,
        calls: '调用',
        used: '已用',
        archive: '可归档',
        tokensWasted: '冗余注入',
        tabAdvice: '建议',
        tabSkills: '全部技能',
        tabTrend: '趋势',
        skill: '技能',
        category: '分类',
        lastUsed: '最近使用',
        defaultLoad: '默认加载',
        enabled: '已启用',
        disabled: '已禁用',
        search: '搜索技能名、描述或分类',
        filterAll: '全部',
        filterEnabled: '已启用',
        filterDisabled: '已禁用',
        callsShort: '调用',
        successShort: '成功率',
        noRows: '没有匹配的技能',
        trendTitle: '最近 14 天调用',
        trendEmpty: '还没有调用数据',
        topSkills: '调用最多的技能',
        p50: 'P50',
        p95: 'P95',
        installPath: '安装路径',
        installedAt: '安装时间',
        firstUsed: '首次使用',
        description: '描述',
        noDescription: '没有描述',
        notEditable: '仅文件型技能可切换',
        disabledNote: (count) => `已禁用 ${count} 个技能，它们不会出现在默认技能目录中。`,
        silenced: (date) => `提醒已静默至 ${date}`,
        settingsNote: '禁用只影响默认加载：模型目录不再包含该技能描述，显式调用仍可加载。',
        loadFailed: '无法读取管理数据',
        retry: '重试',
      },
      en: {
        app: 'SkillHealth',
        popupTitle: 'Skill library needs tidying',
        popupMeta: (score) => `Health ${score}`,
        unused: (count) => `${count} unused`,
        tokens: (value) => `~${value} tokens`,
        noSuggestions: 'Nothing needs attention right now',
        selected: (count) => `Disable${count ? ` (${count})` : ''}`,
        selectedDone: (count) => `${count} skills disabled for future sessions`,
        viewDetails: 'View details',
        ignoreWeek: 'Ignore this week',
        close: 'Close',
        loading: 'Loading…',
        failed: 'Failed to load',
        pageTitle: 'SkillHealth',
        pageSubtitle: 'Usage, default loading, and tidy-up advice',
        refresh: 'Refresh',
        restore: 'Restore reminders',
        health: 'Health',
        coverage: 'Coverage',
        success: 'Success',
        freshness: 'Freshness',
        redundancy: 'Redundancy',
        skills: 'Skills',
        enabledCount: (on, total) => `${on}/${total} enabled`,
        calls: 'Calls',
        used: 'Used',
        archive: 'Archive',
        tokensWasted: 'Redundant tokens',
        tabAdvice: 'Advice',
        tabSkills: 'All skills',
        tabTrend: 'Trend',
        skill: 'Skill',
        category: 'Category',
        lastUsed: 'Last used',
        defaultLoad: 'Default load',
        enabled: 'Enabled',
        disabled: 'Disabled',
        search: 'Search name, description, or category',
        filterAll: 'All',
        filterEnabled: 'Enabled',
        filterDisabled: 'Disabled',
        callsShort: 'Calls',
        successShort: 'Success',
        noRows: 'No matching skills',
        trendTitle: 'Calls in the last 14 days',
        trendEmpty: 'No calls yet',
        topSkills: 'Most-called skills',
        p50: 'P50',
        p95: 'P95',
        installPath: 'Install path',
        installedAt: 'Installed',
        firstUsed: 'First used',
        description: 'Description',
        noDescription: 'No description',
        notEditable: 'Only file-backed skills can be toggled',
        disabledNote: (count) => `${count} skills are disabled and absent from the default catalog.`,
        silenced: (date) => `Reminders silenced until ${date}`,
        settingsNote: 'Disabling only affects default loading: the description leaves the model catalog, while explicit invocation still works.',
        loadFailed: 'Could not load management data',
        retry: 'Retry',
      },
    }

    const CSS = `
.sts-pop{position:fixed;z-index:60;right:24px;bottom:92px;width:360px;max-width:calc(100vw - 32px);pointer-events:auto;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;box-shadow:0 18px 44px -20px color-mix(in srgb,var(--dsw-alias-label-primary) 38%,transparent);overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.45;animation:sts-pop-in .18s ease-out}
@keyframes sts-pop-in{from{opacity:0;transform:translateY(7px) scale(.985)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.sts-pop{animation:none}}
.sts-pop__head{display:flex;align-items:flex-start;gap:9px;padding:13px 13px 9px}
.sts-mark{flex:none;display:grid;place-items:center;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary)}
.sts-pop__titles{flex:1;min-width:0}
.sts-pop__title{font-weight:640;letter-spacing:-.01em}
.sts-pop__meta{display:flex;align-items:center;gap:6px;margin-top:2px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.sts-iconbtn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;width:24px;height:24px;display:grid;place-items:center;cursor:pointer;flex:none}
.sts-iconbtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.sts-iconbtn:focus-visible,.sts-btn:focus-visible,.sts-tab:focus-visible,.sts-switch:focus-visible,.sts-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.sts-pop__summary{display:flex;gap:6px;align-items:center;padding:0 13px 7px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.sts-pop__list{padding:0 7px 5px;max-height:172px;overflow:auto}
.sts-sug{display:flex;align-items:flex-start;gap:8px;padding:7px 6px;border-radius:8px;cursor:pointer}
.sts-sug:hover{background:var(--dsw-alias-bg-layer-2)}
.sts-sug input{margin:2px 0 0;width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary);flex:none;cursor:pointer}
.sts-sug__body{min-width:0;flex:1;display:flex;flex-direction:column}
.sts-sug__name{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sts-sug__why{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sts-pop__empty{padding:10px 13px 12px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.sts-pop__foot{display:flex;align-items:center;gap:6px;padding:9px 11px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.sts-pop__foot .sts-btn--primary{margin-right:auto}
.sts-pop__note{padding:0 13px 9px;font-size:11px;color:var(--dsw-alias-state-success-primary)}
.sts-pop__error{padding:0 13px 9px;font-size:11px;color:var(--dsw-alias-state-error-primary)}
.sts-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);border-radius:7px;height:28px;padding:0 10px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.sts-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.sts-btn[disabled]{opacity:.5;cursor:default}
.sts-btn--primary{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,var(--dsw-alias-border-l1));color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,transparent)}
.sts-btn--primary:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 15%,transparent)}
.sts-btn--ghost{border-color:transparent;color:var(--dsw-alias-label-secondary)}
.sts-page{height:100%;min-height:100%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px}
.sts-page__head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:22px 28px 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.sts-page__title{font-size:19px;font-weight:650;letter-spacing:-.015em}
.sts-page__sub{margin-top:3px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.sts-page__actions{display:flex;gap:7px;flex:none}
.sts-page__body{flex:1;min-height:0;overflow:auto;padding:20px 28px 48px}
.sts-page__inner{max-width:1120px;margin:0 auto}
.sts-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.sts-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:11px;padding:13px 15px;min-width:0}
.sts-card__label{font-size:11px;color:var(--dsw-alias-label-secondary);letter-spacing:.01em}
.sts-card__value{margin-top:3px;font-size:23px;font-weight:650;letter-spacing:-.02em;line-height:1.15}
.sts-card__hint{margin-top:4px;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sts-dims{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin-top:10px}
.sts-dim__label{display:flex;justify-content:space-between;gap:4px;font-size:10px;color:var(--dsw-alias-label-secondary)}
.sts-dim__bar{height:3px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);margin-top:3px;overflow:hidden}
.sts-dim__fill{height:100%;background:var(--dsw-alias-brand-primary);border-radius:2px}
.sts-tabs{display:flex;gap:3px;padding:3px;margin:16px 0 14px;width:max-content;max-width:100%;background:var(--dsw-alias-bg-layer-2);border-radius:9px}
.sts-tab{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:5px 12px;border-radius:7px;cursor:pointer}
.sts-tab.is-active{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent)}
.sts-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.sts-input{flex:1;min-width:180px;height:30px;padding:0 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
.sts-input::placeholder{color:var(--dsw-alias-label-secondary)}
.sts-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.sts-filters{display:flex;gap:4px}
.sts-filter{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;font:inherit;font-size:11px;padding:4px 9px;cursor:pointer}
.sts-filter.is-active{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.sts-table{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.sts-thead,.sts-row{display:grid;grid-template-columns:minmax(170px,1.9fr) 84px 62px 66px 88px 74px 24px;gap:10px;align-items:center;padding:9px 13px}
.sts-thead{font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1)}
.sts-row{border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer;min-height:42px}
.sts-row:last-child{border-bottom:0}
.sts-row:hover{background:var(--dsw-alias-bg-layer-2)}
.sts-row__name{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sts-row__sub{font-size:10px;color:var(--dsw-alias-label-secondary);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sts-cell{font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
.sts-cell--strong{color:var(--dsw-alias-label-primary)}
.sts-detail{padding:2px 13px 15px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent);border-bottom:1px solid var(--dsw-alias-border-l1)}
.sts-detail__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 26px;font-size:12px}
.sts-kv{min-width:0}
.sts-kv__k{font-size:10px;color:var(--dsw-alias-label-secondary);margin-bottom:1px}
.sts-kv__v{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sts-kv__v--mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
.sts-desc{margin-top:10px;font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.5;white-space:pre-wrap;max-height:74px;overflow:auto}
.sts-detail__issues{display:flex;flex-wrap:wrap;gap:5px;margin-top:9px}
.sts-tag{font-size:10px;padding:2px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);white-space:nowrap}
.sts-tag--warn{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 35%,var(--dsw-alias-border-l1))}
.sts-switch{appearance:none;width:34px;height:20px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);position:relative;cursor:pointer;padding:0;transition:background .12s ease,border-color .12s ease}
.sts-switch.is-on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.sts-switch[disabled]{opacity:.5;cursor:default}
.sts-switch__knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:999px;background:var(--dsw-alias-bg-base);box-shadow:0 1px 2px color-mix(in srgb,var(--dsw-alias-label-primary) 30%,transparent);transition:transform .12s ease}
.sts-switch.is-on .sts-switch__knob{transform:translateX(14px);background:var(--dsw-alias-bg-layer-1)}
.sts-issue{display:grid;grid-template-columns:auto minmax(140px,1fr) minmax(0,2.2fr) 74px;gap:10px;align-items:center;padding:9px 13px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.sts-issue:last-child{border-bottom:0}
.sts-issue__name{font-weight:600;font-size:12px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sts-issue__text{font-size:12px;color:var(--dsw-alias-label-secondary);min-width:0}
.sts-issue__actions{display:flex;justify-content:flex-end}
.sts-empty{padding:34px 16px;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary);border:1px dashed var(--dsw-alias-border-l1);border-radius:10px}
.sts-note{font-size:11px;color:var(--dsw-alias-label-secondary);margin:0 0 12px}
.sts-chart{display:flex;align-items:stretch;gap:5px;height:170px;padding:14px 12px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.sts-bar{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;gap:5px;height:100%}
.sts-bar__track{flex:1;display:flex;align-items:flex-end}
.sts-bar__fill{width:100%;min-height:2px;border-radius:3px 3px 0 0;background:var(--dsw-alias-brand-primary);opacity:.82}
.sts-bar__label{font-size:9px;color:var(--dsw-alias-label-secondary);text-align:center;white-space:nowrap;overflow:hidden}
.sts-top{display:grid;grid-template-columns:minmax(140px,1.6fr) 70px 60px 60px;gap:10px;align-items:center;padding:8px 13px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px}
.sts-top:last-child{border-bottom:0}
.sts-loading{display:grid;place-items:center;height:100%;font-size:12px;color:var(--dsw-alias-label-secondary)}
.sts-error{padding:16px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:10px;color:var(--dsw-alias-state-error-primary);font-size:12px;display:flex;align-items:center;gap:10px}
@media (max-width:900px){.sts-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.sts-thead,.sts-row{grid-template-columns:minmax(150px,1.8fr) 62px 66px 84px 68px 22px}.sts-thead> :nth-child(2),.sts-row> :nth-child(2){display:none}}
@media (max-width:680px){.sts-page__head{padding:18px 16px 12px}.sts-page__body{padding:16px 16px 40px}.sts-kpis{grid-template-columns:1fr}.sts-issue{grid-template-columns:auto minmax(110px,1fr) 64px}.sts-issue__text{display:none}.sts-thead,.sts-row{grid-template-columns:minmax(130px,1.8fr) 54px 62px 68px 22px}.sts-thead> :nth-child(4),.sts-row> :nth-child(4),.sts-thead> :nth-child(5),.sts-row> :nth-child(5){display:none}.sts-detail__grid{grid-template-columns:1fr}}
`

    function useLocale(service) {
      const read = () => {
        try {
          return service?.getLocale?.()?.active ?? 'zh'
        } catch {
          return 'zh'
        }
      }
      const [locale, setLocale] = React.useState(read)
      React.useEffect(() => {
        if (!service?.subscribe) return undefined
        return service.subscribe(() => setLocale(read()))
      }, [service])
      return TEXT[locale] ? locale : 'zh'
    }

    async function request(path, options = {}) {
      const response = await fetch(path, { credentials: 'same-origin', ...options })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    }

    function formatTokens(value) {
      if (!Number.isFinite(value) || value <= 0) return '0'
      if (value >= 1000) {
        const thousands = value / 1000
        return `${thousands >= 10 ? Math.round(thousands) : Math.round(thousands * 10) / 10}k`
      }
      return String(Math.round(value))
    }

    function shortDate(iso) {
      if (!iso) return '—'
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return '—'
      return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }

    function relative(iso, locale) {
      if (!iso) return locale === 'en' ? 'never' : '从未'
      const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
      if (!Number.isFinite(days) || days < 0) return shortDate(iso)
      if (days === 0) return locale === 'en' ? 'today' : '今天'
      return locale === 'en' ? `${days}d ago` : `${days} 天前`
    }

    function readPopupState() {
      try {
        return JSON.parse(localStorage.getItem(POPUP_KEY) || '{}')
      } catch {
        return {}
      }
    }

    function writePopupState(patch) {
      try {
        localStorage.setItem(POPUP_KEY, JSON.stringify({ ...readPopupState(), ...patch }))
      } catch {
        // Private browsing can deny storage; the popup still works for this page.
      }
    }

    function Mark({ size = 18 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, fill: 'currentColor',
      },
      h('rect', { x: 3, y: 13, width: 4, height: 8, rx: 1.2 }),
      h('rect', { x: 9, y: 9, width: 4, height: 12, rx: 1.2, opacity: 0.78 }),
      h('rect', { x: 15, y: 5, width: 4, height: 16, rx: 1.2 }),
      )
    }

    function CloseIcon() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' },
        h('path', { d: 'M4 4l8 8M12 4l-8 8' }))
    }

    function Chevron({ open }) {
      return h('svg', {
        width: 12, height: 12, viewBox: '0 0 16 16', 'aria-hidden': true, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
        style: { transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s ease', opacity: 0.7 },
      }, h('path', { d: 'M6 4l4 4-4 4' }))
    }

    function Switch({ checked, disabled, label, onChange }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked,
        'aria-label': label,
        disabled,
        className: `sts-switch${checked ? ' is-on' : ''}`,
        onClick: (event) => {
          event.stopPropagation()
          onChange(!checked)
        },
        onKeyDown: (event) => event.stopPropagation(),
      }, h('span', { className: 'sts-switch__knob' }))
    }

    function Popup(props) {
      const locale = useLocale(props.localeService)
      const text = TEXT[locale]
      const activePanel = props.usePanelInfo((state) => state.activePanelId)
      const [hidden, setHidden] = React.useState(false)
      const [data, setData] = React.useState(null)
      const [selected, setSelected] = React.useState([])
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState(null)
      const [error, setError] = React.useState(null)

      React.useEffect(() => {
        const state = readPopupState()
        const now = Date.now()
        if ((state.dismissedUntil && Date.parse(state.dismissedUntil) > now) ||
          (state.lastShownAt && now - Date.parse(state.lastShownAt) < POPUP_COOLDOWN_MS)) {
          setHidden(true)
          return undefined
        }
        let alive = true
        request(`${API}/state`)
          .then((next) => {
            if (!alive) return
            setData(next)
            if (next?.reminder) writePopupState({ lastShownAt: new Date().toISOString() })
          })
          .catch((failure) => {
            if (alive) setError(failure instanceof Error ? failure.message : String(failure))
          })
        return () => { alive = false }
      }, [])

      if (hidden || activePanel === 'skilltrace') return null
      const pack = data?.reminderI18n?.[locale] ?? data?.reminderI18n?.zh
      if (!pack?.due) return null
      const banner = pack.banner
      const suggestions = (data.suggestions ?? []).filter((item) => item.editable !== false).slice(0, 3)
      const why = locale === 'en' ? 'text_en' : 'text_zh'
      const action = locale === 'en' ? 'action_en' : 'action_zh'

      const toggle = (name) => {
        setSelected((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name])
      }

      const close = () => {
        writePopupState({ lastShownAt: new Date().toISOString() })
        setHidden(true)
      }

      const details = () => {
        close()
        try {
          props.layout?.selectPanel('skilltrace')
        } catch {
          // The main panel is not registered yet; the sidebar icon remains.
        }
      }

      const ignore = async () => {
        setBusy(true)
        try {
          await request(`${API}/action`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'ignore' }),
          })
          writePopupState({ dismissedUntil: new Date(Date.now() + 14 * 86_400_000).toISOString() })
          setHidden(true)
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setBusy(false)
        }
      }

      const disable = async () => {
        if (selected.length === 0) return
        setBusy(true)
        setError(null)
        try {
          const result = await request(`${API}/skills`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ skills: selected, enabled: false }),
          })
          if (result?.state) setData(result.state)
          setNote(text.selectedDone(selected.length))
          setSelected([])
          if (!result?.state?.reminder) {
            writePopupState({ dismissedUntil: new Date(Date.now() + 86_400_000).toISOString() })
            setTimeout(() => setHidden(true), 900)
          }
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setBusy(false)
        }
      }

      return h(React.Fragment, null,
        h('style', { key: 'sts-pop-style' }, CSS),
        h('aside', { className: 'sts-pop', role: 'dialog', 'aria-label': text.app },

        h('div', { className: 'sts-pop__head' },
          h('span', { className: 'sts-mark', style: { width: 30, height: 30 } }, h(Mark, { size: 17 })),
          h('div', { className: 'sts-pop__titles' },
            h('div', { className: 'sts-pop__title' }, banner.title),
            h('div', { className: 'sts-pop__meta' },
              h('span', null, text.popupMeta(banner.score)),
              h('span', null, '·'),
              h('span', null, text.unused(data.archiveCount ?? banner.skills)),
            ),
          ),
          h('button', { type: 'button', className: 'sts-iconbtn', 'aria-label': text.close, onClick: close }, h(CloseIcon)),
        ),
        h('div', { className: 'sts-pop__summary' },
          h('span', null, text.tokens(formatTokens(banner.tokensWasted))),
          h('span', null, '·'),
          h('span', null, banner.detail),
        ),
        suggestions.length
          ? h('div', { className: 'sts-pop__list' }, suggestions.map((item) => h('label', {
            key: item.skill,
            className: 'sts-sug',
          },
          h('input', {
            type: 'checkbox',
            checked: selected.includes(item.skill),
            onChange: () => toggle(item.skill),
          }),
          h('span', { className: 'sts-sug__body' },
            h('span', { className: 'sts-sug__name', title: item.skill }, item.skill),
            h('span', { className: 'sts-sug__why' }, `${item[action]} · ${item[why]}`),
          ),
          )))
          : h('div', { className: 'sts-pop__empty' }, text.noSuggestions),
        note ? h('div', { className: 'sts-pop__note' }, note) : null,
        error ? h('div', { className: 'sts-pop__error' }, `${text.failed}: ${error}`) : null,
        h('div', { className: 'sts-pop__foot' },
          suggestions.length
            ? h('button', {
              type: 'button',
              className: 'sts-btn sts-btn--primary',
              disabled: busy || selected.length === 0,
              onClick: disable,
            }, text.selected(selected.length))
            : null,
            h('button', { type: 'button', className: 'sts-btn', onClick: details }, text.viewDetails),
            h('button', { type: 'button', className: 'sts-btn sts-btn--ghost', disabled: busy, onClick: ignore }, text.ignoreWeek),
          ),
        ),
      )
    }

    function PanelIcon({ size = 18, active }) {
      return h('span', { style: { display: 'grid', placeItems: 'center', opacity: active ? 1 : 0.72 } },
        h(Mark, { size }))
    }

    function Kpi({ label, value, hint, children }) {
      return h('div', { className: 'sts-card' },
        h('div', { className: 'sts-card__label' }, label),
        h('div', { className: 'sts-card__value' }, value),
        hint ? h('div', { className: 'sts-card__hint' }, hint) : null,
        children,
      )
    }

    function Dim({ label, value }) {
      const safe = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
      return h('div', null,
        h('div', { className: 'sts-dim__label' }, h('span', null, label), h('span', null, safe)),
        h('div', { className: 'sts-dim__bar' }, h('div', { className: 'sts-dim__fill', style: { width: `${safe}%` } })),
      )
    }

    function SkillDetail({ skill, text, locale }) {
      const issues = skill.issues ?? []
      return h('div', { className: 'sts-detail' },
        h('div', { className: 'sts-detail__grid' },
          h('div', { className: 'sts-kv' }, h('div', { className: 'sts-kv__k' }, text.description),
            h('div', { className: 'sts-kv__v' }, skill.description || text.noDescription)),
          h('div', { className: 'sts-kv' }, h('div', { className: 'sts-kv__k' }, text.installPath),
            h('div', { className: 'sts-kv__v sts-kv__v--mono', title: skill.path ?? '' }, skill.path ?? '—')),
          h('div', { className: 'sts-kv' }, h('div', { className: 'sts-kv__k' }, text.installedAt),
            h('div', { className: 'sts-kv__v' }, skill.installed_at ? shortDate(skill.installed_at) : '—')),
          h('div', { className: 'sts-kv' }, h('div', { className: 'sts-kv__k' }, `${text.firstUsed} / ${text.lastUsed}`),
            h('div', { className: 'sts-kv__v' }, `${relative(skill.first_used_at, locale)} / ${relative(skill.last_used_at, locale)}`)),
          h('div', { className: 'sts-kv' }, h('div', { className: 'sts-kv__k' }, `${text.p50} / ${text.p95}`),
            h('div', { className: 'sts-kv__v' }, `${skill.p50_ms ?? '—'} ms / ${skill.p95_ms ?? '—'} ms`)),
          h('div', { className: 'sts-kv' }, h('div', { className: 'sts-kv__k' }, text.skill),
            h('div', { className: 'sts-kv__v' }, `${skill.category ?? '—'} · ${skill.source ?? '—'} · ${skill.tokens_est ?? 0} tokens`)),
          skill.editable === false
            ? h('div', { className: 'sts-kv' }, h('div', { className: 'sts-kv__k' }, text.defaultLoad),
              h('div', { className: 'sts-kv__v' }, text.notEditable))
            : null,
        ),
        issues.length
          ? h('div', { className: 'sts-detail__issues' }, issues.map((issue, index) => h('span', {
            key: `${issue.rule}:${index}`,
            className: 'sts-tag sts-tag--warn',
          }, `${issue.rule_zh ?? issue.rule} · ${issue.text_zh ?? ''}`)))
          : null,
        h('div', { className: 'sts-desc' }, skill.description || text.noDescription),
      )
    }

    function ManagePage(props) {
      const locale = useLocale(props.localeService)
      const text = TEXT[locale]
      const [data, setData] = React.useState(null)
      const [tab, setTab] = React.useState('advice')
      const [query, setQuery] = React.useState('')
      const [filter, setFilter] = React.useState('all')
      const [expanded, setExpanded] = React.useState(null)
      const [busy, setBusy] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [loading, setLoading] = React.useState(true)

      const load = React.useCallback(async (force) => {
        setLoading(true)
        setError(null)
        try {
          const next = await request(`${API}/manage${force ? '?refresh=1' : ''}`)
          setData(next)
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setLoading(false)
        }
      }, [])

      React.useEffect(() => {
        void load(false)
        const interval = setInterval(() => { void load(false) }, 120_000)
        return () => clearInterval(interval)
      }, [load])

      const toggleSkill = async (name, enabled) => {
        setBusy(name)
        setError(null)
        try {
          const result = await request(`${API}/skills`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ skill: name, enabled }),
          })
          if (result?.manage) setData(result.manage)
          if (result?.errors?.length) setError(result.errors.map((item) => `${item.skill}: ${item.reason}`).join(', '))
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setBusy(null)
        }
      }

      const reset = async () => {
        setBusy('reset')
        try {
          await request(`${API}/action`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'reset' }),
          })
          await load(true)
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setBusy(null)
        }
      }

      if (loading && !data) return h('div', { className: 'sts-page' }, h('div', { className: 'sts-loading' }, text.loading))
      if (error && !data) {
        return h('div', { className: 'sts-page' }, h('div', { className: 'sts-page__body' },
          h('div', { className: 'sts-error' }, text.loadFailed, h('button', { type: 'button', className: 'sts-btn', onClick: () => load(true) }, text.retry)),
        ))
      }
      if (!data) return null

      const dims = data.dimensions ?? {}
      const enabled = data.skills.filter((skill) => skill.enabled)
      const disabled = data.skills.filter((skill) => !skill.enabled)
      const skillByName = new Map(data.skills.map((skill) => [skill.name, skill]))
      const calls = data.totals?.calls ?? 0
      const totalOk = data.skills.reduce((sum, skill) => sum + skill.ok, 0)

      const visibleSkills = data.skills.filter((skill) => {
        if (filter === 'enabled' && !skill.enabled) return false
        if (filter === 'disabled' && skill.enabled) return false
        if (!query.trim()) return true
        const needle = query.trim().toLowerCase()
        return skill.name.toLowerCase().includes(needle) ||
          (skill.description ?? '').toLowerCase().includes(needle) ||
          (skill.category ?? '').toLowerCase().includes(needle)
      })

      const days = (data.daily ?? []).slice(-14)
      const maxCalls = Math.max(1, ...days.map((day) => day.calls))
      const top = data.skills.filter((skill) => skill.calls > 0)
        .sort((left, right) => right.calls - left.calls).slice(0, 8)

      const ruleGroups = new Map()
      for (const issue of data.issues ?? []) {
        if (!ruleGroups.has(issue.rule)) ruleGroups.set(issue.rule, [])
        ruleGroups.get(issue.rule).push(issue)
      }

      return h(React.Fragment, null,
        h('style', { key: 'sts-page-style' }, CSS),
        h('div', { className: 'sts-page' },
        h('header', { className: 'sts-page__head' },
          h('div', null,
            h('div', { className: 'sts-page__title' }, text.pageTitle),
            h('div', { className: 'sts-page__sub' }, text.pageSubtitle),
          ),
          h('div', { className: 'sts-page__actions' },
            h('button', { type: 'button', className: 'sts-btn', disabled: busy === 'reset', onClick: reset }, text.restore),
            h('button', { type: 'button', className: 'sts-btn', disabled: loading, onClick: () => load(true) }, text.refresh),
          ),
        ),
        h('div', { className: 'sts-page__body' },
          h('div', { className: 'sts-page__inner' },
            error ? h('div', { className: 'sts-error', style: { marginBottom: 12 } }, error) : null,
            h('div', { className: 'sts-kpis' },
              h(Kpi, { label: text.health, value: data.score },
                h('div', { className: 'sts-dims' },
                  h(Dim, { label: text.coverage, value: dims.usage }),
                  h(Dim, { label: text.success, value: dims.success }),
                  h(Dim, { label: text.freshness, value: dims.freshness }),
                  h(Dim, { label: text.redundancy, value: dims.redundancy }),
                )),
              h(Kpi, {
                label: text.skills,
                value: data.skills.length,
                hint: text.enabledCount(enabled.length, data.skills.length),
              }),
              h(Kpi, {
                label: text.calls,
                value: calls,
                hint: `${text.used} ${data.totals?.used ?? 0} · ${text.success} ${calls ? Math.round((totalOk / calls) * 100) : 100}%`,
              }),
              h(Kpi, {
                label: text.archive,
                value: data.archiveCount ?? 0,
                hint: `${text.tokensWasted} ${formatTokens(data.tokensWasted ?? 0)}`,
              }),
            ),
            h('div', { className: 'sts-tabs' },
              h('button', { type: 'button', className: `sts-tab${tab === 'advice' ? ' is-active' : ''}`, onClick: () => setTab('advice') }, `${text.tabAdvice} ${data.issues?.length ?? 0}`),
              h('button', { type: 'button', className: `sts-tab${tab === 'skills' ? ' is-active' : ''}`, onClick: () => setTab('skills') }, `${text.tabSkills} ${data.skills.length}`),
              h('button', { type: 'button', className: `sts-tab${tab === 'trend' ? ' is-active' : ''}`, onClick: () => setTab('trend') }, text.tabTrend),
            ),
            tab === 'advice' ? h('div', null,
              disabled.length ? h('div', { className: 'sts-note' }, text.disabledNote(disabled.length)) : null,
              (data.issues?.length ?? 0) === 0
                ? h('div', { className: 'sts-empty' }, text.noSuggestions)
                : [...ruleGroups.entries()].map(([rule, issues]) => h('div', { key: rule, style: { marginBottom: 14 } },
                  h('div', { className: 'sts-note', style: { display: 'flex', gap: 8, alignItems: 'center' } },
                    h('span', { className: 'sts-tag sts-tag--warn' }, issues[0].rule_zh ?? rule),
                    h('span', null, `${issues.length}`),
                  ),
                  h('div', { className: 'sts-table' }, issues.slice(0, 60).map((issue) => {
                    const skill = skillByName.get(issue.skill)
                    return h('div', { key: `${rule}:${issue.skill}:${issue.text_zh}`, className: 'sts-issue' },
                      h('span', { className: 'sts-tag' }, issue.action_zh ?? issue.action),
                      h('span', { className: 'sts-issue__name', title: issue.skill }, issue.skill),
                      h('span', { className: 'sts-issue__text' }, issue.text_zh ?? issue.rule),
                      h('span', { className: 'sts-issue__actions' },
                        h(Switch, {
                          checked: Boolean(skill?.enabled),
                          disabled: busy === issue.skill || skill?.editable === false,
                          label: `${skill?.enabled ? text.disabled : text.enabled} ${issue.skill}`,
                          onChange: (next) => toggleSkill(issue.skill, next),
                        }),
                      ),
                    )
                  })),
                )),
            ) : null,
            tab === 'skills' ? h('div', null,
              h('div', { className: 'sts-toolbar' },
                h('input', {
                  className: 'sts-input',
                  value: query,
                  placeholder: text.search,
                  onChange: (event) => setQuery(event.target.value),
                  'aria-label': text.search,
                }),
                h('div', { className: 'sts-filters' },
                  h('button', { type: 'button', className: `sts-filter${filter === 'all' ? ' is-active' : ''}`, onClick: () => setFilter('all') }, text.filterAll),
                  h('button', { type: 'button', className: `sts-filter${filter === 'enabled' ? ' is-active' : ''}`, onClick: () => setFilter('enabled') }, text.filterEnabled),
                  h('button', { type: 'button', className: `sts-filter${filter === 'disabled' ? ' is-active' : ''}`, onClick: () => setFilter('disabled') }, text.filterDisabled),
                ),
              ),
              h('div', { className: 'sts-table' },
                h('div', { className: 'sts-thead' },
                  h('span', null, text.skill),
                  h('span', null, text.category),
                  h('span', null, text.callsShort),
                  h('span', null, text.successShort),
                  h('span', null, text.lastUsed),
                  h('span', null, text.defaultLoad),
                  h('span', null, ''),
                ),
                visibleSkills.length === 0
                  ? h('div', { className: 'sts-empty', style: { border: 0 } }, text.noRows)
                  : visibleSkills.map((skill) => h(React.Fragment, { key: skill.name },
                    h('div', {
                      className: 'sts-row',
                      role: 'button',
                      tabIndex: 0,
                      onClick: () => setExpanded(expanded === skill.name ? null : skill.name),
                      onKeyDown: (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setExpanded(expanded === skill.name ? null : skill.name)
                        }
                      },
                    },
                    h('div', { style: { minWidth: 0 } },
                      h('div', { className: 'sts-row__name', title: skill.name }, skill.name),
                      h('div', { className: 'sts-row__sub' }, `${skill.category ?? '—'} · ${skill.tokens_est ?? 0} tokens`),
                    ),
                    h('span', { className: 'sts-cell' }, skill.category ?? '—'),
                    h('span', { className: 'sts-cell sts-cell--strong' }, skill.calls),
                    h('span', { className: 'sts-cell' }, skill.success_rate === null ? '—' : `${skill.success_rate}%`),
                    h('span', { className: 'sts-cell' }, relative(skill.last_used_at, locale)),
                    h('span', { style: { display: 'flex' } },
                      h(Switch, {
                        checked: skill.enabled,
                        disabled: busy === skill.name || skill.editable === false,
                        label: `${skill.enabled ? text.disabled : text.enabled} ${skill.name}`,
                        onChange: (next) => toggleSkill(skill.name, next),
                      }),
                    ),
                    h('span', { className: 'sts-cell', style: { display: 'flex', justifyContent: 'flex-end' } }, h(Chevron, { open: expanded === skill.name })),
                    ),
                    expanded === skill.name ? h(SkillDetail, { skill, text, locale }) : null,
                  )),
              ),
              h('div', { className: 'sts-note', style: { marginTop: 10 } }, text.settingsNote),
            ) : null,
            tab === 'trend' ? h('div', null,
              h('div', { className: 'sts-note' }, text.trendTitle),
              days.length === 0
                ? h('div', { className: 'sts-empty' }, text.trendEmpty)
                : h('div', { className: 'sts-chart' }, days.map((day) => h('div', {
                  key: day.day,
                  className: 'sts-bar',
                  title: `${day.day} · ${day.calls} calls`,
                },
                h('div', { className: 'sts-bar__track' },
                  h('div', { className: 'sts-bar__fill', style: { height: `${Math.max(2, (day.calls / maxCalls) * 100)}%` } }),
                ),
                h('div', { className: 'sts-bar__label' }, shortDate(day.day)),
                ))),
              h('div', { className: 'sts-note', style: { marginTop: 18 } }, text.topSkills),
              top.length === 0
                ? h('div', { className: 'sts-empty' }, text.trendEmpty)
                : h('div', { className: 'sts-table' },
                  h('div', { className: 'sts-top', style: { background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-secondary)', fontSize: 11 } },
                    h('span', null, text.skill), h('span', null, text.callsShort),
                    h('span', null, text.p50), h('span', null, text.p95)),
                  top.map((skill) => h('div', { key: skill.name, className: 'sts-top' },
                    h('span', { className: 'sts-row__name', title: skill.name }, skill.name),
                    h('span', { className: 'sts-cell sts-cell--strong' }, skill.calls),
                    h('span', { className: 'sts-cell' }, skill.p50_ms === null ? '—' : `${skill.p50_ms}ms`),
                    h('span', { className: 'sts-cell' }, skill.p95_ms === null ? '—' : `${skill.p95_ms}ms`),
                  )),
                ),
            ) : null,
          ),
        ),
      ))
    }

    return {
      inject: ['slots', 'layout'],
      apply(ctx) {
        const localeService = ctx.get('locale')
        const layout = ctx.get('layout')
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'skilltrace-popup',
          order: 30,
        }, (props) => h(Popup, { ...props, localeService, layout })))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'skilltrace',
          order: 20,
          label: () => 'SkillHealth',
        }, PanelIcon))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'skilltrace',
        }, (props) => h(ManagePage, { ...props, localeService })))
      },
    }
  },
})
