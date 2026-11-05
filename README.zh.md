# SkillHealth

[English](README.md) | **中文**

SkillHealth 是一个 DeepSeek Harness（DSH）插件：采集技能调用，回答三个问题——技能到底有没有被用、用得好不好、技能库该不该整理。

## 功能

- 跨宿主事件流：DSH 的 `tools/execute` 与 Claude Code 的 `PreToolUse/PostToolUse` 共用一份追加式 JSONL
- 配对去重：`session_id + tool_use_id`，缺失时退化为 `skill + 60s` 时间窗
- 可重建索引：`index.sqlite3` / `rollup.sqlite3` 删除后由 `events/` 全量重建
- 健康诊断：六条规则 + 四维加权分（使用覆盖 / 成功率 / 新鲜度 / 冗余控制）
- 克制提醒：终端一行、系统通知、页面弹窗；每会话最多一次，可静默/关闭
- 标准禁用：直接读写 SKILL.md 的 Agent Skills 字段 `disable-model-invocation`
- 管理页：建议、全部技能、趋势三个视图，支持搜索、展开详情、默认加载开关
- 隐私优先：只存元数据，不上报任何远端

## 安装

```bash
git clone https://github.com/hello-piper/dsh-skillhealth.git
```

在 DSH 中把这个目录作为 bundle 安装：

- 通过 Plugin Manager 选择“从本地目录安装”，或
- 让 agent 调用 `plugin_manager`，`action: install_bundle`，`target` 为克隆目录的绝对路径

安装后重启宿主以加载 Host 模块；Client 刷新页面即可。默认数据目录是 `~/.agents/_skill-usage-stats`。

## 落盘布局

```
~/.agents/_skill-usage-stats/
├── events/YYYY-MM-DD.jsonl   # 只追加的事件流，所有宿主共用，行内带 agent
├── index.sqlite3              # 配对去重后的索引（可删，可全量重建）
├── rollup.sqlite3             # 按天 / 技能 / agent 的聚合与健康快照（可删，可重建）
├── collector.log              # 丢弃事件、schema 错误、通知失败，行内带 [宿主] 前缀
└── agents/<宿主>/
    ├── health.json             # 最近一次健康诊断快照
    ├── health-state.json       # 上次整理时间、上次分数、重建时间
    ├── config.toml             # 该宿主的采集 / 健康 / 提醒阈值
    ├── notify.json             # 提醒节流、静默、关闭的规则、已提醒会话
    └── install.json            # 接入方式与 hook 版本
```

删除 `index.sqlite3` / `rollup.sqlite3` 只丢缓存；删除 `events/` 才是真的删数据。按宿主查看用 `SELECT ... WHERE agent = ?`，不需要多份库。

## 事件契约

`src/core/event.mjs` 独占字段集合，门面只能通过 `makeEvent()` 产出事件：

- 必备：`id ts schema agent skill trigger phase session_id cwd via status`
- 可选：`tool_use_id prompt_hash duration_ms error_code agent_version`
- `phase ∈ {start, end}`；`start` 只能是 `pending`；`end` 必须是 `ok|error|abort`
- 未知字段直接抛错，不允许某个宿主偷偷多带字段
- `id` 由 `agent + session_id + (tool_use_id | skill+秒) + phase` 决定，重放天然幂等

宿主差异全部在 `src/adapters/`：

| 适配器 | 接入点 | `via` |
|---|---|---|
| `dsh.mjs` | `tools/execute` 包住 `skill` 工具的真实派发 | `tool-event` |
| `claude-code.mjs` | `PreToolUse` / `PostToolUse` hook（`bin/collect.mjs` 接收） | `hook` |

`test/adapter-parity.test.mjs` 断言两个适配器产出的事件字段集合完全一致，并覆盖未知字段、非法 phase/status、幂等 id。

## 配对

合并 key = `session_id + tool_use_id`；缺失 `tool_use_id` 时退化为 `skill + 60s 时间窗`。

- start 后 30 分钟仍无 end → 合并时标记 `abort`（进程被杀 / 用户中断）
- 30 分钟内的孤立 start 保持 `pending`，等下一次重建再定，不凭空造 abort
- 找不到 start 的 end 写入 `collector.log`
- 同一事件重复写入由 `id` 去重

## 聚合表

`index.sqlite3`：`calls`（配对结果）、`event_seen`（幂等）、`meta`。

`rollup.sqlite3`：

| 表 | 主键 | 用途 |
|---|---|---|
| `rollup_daily` | day, agent, skill | 趋势、排行、p50/p95 |
| `skill_meta` | skill | 首次/最近使用、安装路径、描述指纹 |
| `cooccur` | session_id, skill_a, skill_b | 同会话共现 |
| `health_snapshot` | scanned_at | 健康分、四维分、问题 JSON |

UI 不扫全量 JSONL：弹窗和 `/skillhealth` 读 `health.json` + `rollup`，周报只读最近 7 天的 `rollup_daily`。

## 健康诊断

六条规则（命中即一条 issue）：

| 规则 | 判定 | 建议 |
|---|---|---|
| 从未使用 | 安装 > 30 天且 0 次调用 | 归档 |
| 长期未用 | 最后使用 > 60 天且累计 < 3 次 | 归档 |
| 功能重复 | 描述相似度 ≥ 0.8 且同类别 | 合并 |
| 路径失效 | SKILL.md 或相对依赖不存在 | 修复 / 删除 |
| 高失败率 | ≥ 10 次调用且失败率 > 15% | 排查 |
| 触发冲突 | 关键词重叠且同会话共现 ≥ 3 次 | 改描述 |

健康分 = 使用覆盖 35% + 成功率 25% + 新鲜度 25% + 冗余控制 15%，四维各 0–100。
“同类别”取技能来源（project / user / runtime / bundled / custom）；触发冲突是关键词重叠 + 共现次数的启发式，不读取模型真实路由。

## 主动提醒

触发条件：健康分 < 75 或 issue ≥ 10，且不在静默期。健康分回升到 80 以上自动停止，并在周报里记录“已恢复”。

三个渠道共用一份文案：

- 终端：会话第一个 turn 向 stderr 打一行，不进入模型上下文
- 系统通知：macOS `osascript`；Linux `notify-send`；失败只写 `collector.log`
- 页面弹窗：`shell.overlay` 浮层，默认只列 3 个建议技能，可直接勾选禁用
- 管理页：左侧栏 `SkillHealth` 图标进入 `main` 面板，含建议、全部技能、趋势三个视图

克制：

1. 每个会话最多提醒一次；`notify.json` 记录已提醒会话
2. “本周忽略”静默 14 天；“关闭”关闭当前命中的规则类，周报照常
3. 健康分 ≥ 80 自动停；通知有 24 小时冷却

## 默认加载与禁用

“默认加载”开关直接读写 SKILL.md 的 Agent Skills 标准字段：

```yaml
---
name: your-skill
description: ...
disable-model-invocation: true
---
```

- `true`：DSH 的 skill provider 把 `modelInvocable` 置为 false，模型目录和 `skill` 工具不再暴露它
- 用户仍可通过 `/your-skill` 显式调用（`user-invocable` 默认为 true）
- 开关关闭时写回 `false`，保留 frontmatter 其余内容和文件权限
- 没有文件路径的 runtime/remote skill 不可切换，页面会显示为不可编辑
- 管理页每次刷新都直接读取 SKILL.md，因此上游更新覆盖字段或手动改文件后，页面会显示真实状态
- 上游 `skills update` 会覆盖该字段，这是已知代价；页面会如实显示“已启用”

## 隐私

- 只存元数据：技能名、耗时、状态、cwd、prompt 的 sha1 前 8 位
- 不存 prompt / 响应正文 / 文件内容
- cwd 中的 `$HOME` 折叠为 `~`
- 不上报任何远端，系统通知只在本机

## 配置

每个宿主一份 `agents/<宿主>/config.toml`，可分别调阈值。插件 patch 里的 `config.notify` 覆盖通知开关；其余以文件为准。

```toml
[collect]
fallback_window_ms = 60000
abort_after_ms = 1800000
rebuild_debounce_ms = 1200

[health]
unused_days = 30
stale_days = 60
duplicate_similarity = 0.8
failure_min_calls = 10
failure_rate = 0.15
score_alert_below = 75
score_recover_above = 80
issue_alert_count = 10

[notify]
enabled = true
terminal = true
system = true
banner = true
cooldown_hours = 24
ignore_days = 14
```

## 使用

- `/skillhealth`：终端/会话内打印健康分、四维分、规则命中与建议
- `GET /skill-usage-stats/api/state?session=<id>`：弹窗数据，含最多 3 条建议（需页面同源 cookie）
- `GET /skill-usage-stats/api/manage`：管理页全量技能、调用统计、30 天趋势、问题清单
- `POST /skill-usage-stats/api/skills`：`{"skill":"name","enabled":false}` 或 `{"skills":[...],"enabled":false}`
- `POST /skill-usage-stats/api/action`：`{"action":"ignore"|"close"|"reset"|"refresh","rule?":...,"session":...}`
- `GET /skill-usage-stats/api/weekly`：本周周报

## 测试

```bash
cd dsh-skillhealth
npm test
```

覆盖：契约一致性、配对/超时/幂等、六条规则、四维分、提醒门控、文案、采集器写入与删库重建、健康服务动作、`disable-model-invocation` 读写与文件状态覆盖缓存。

## 已知边界

- DSH 没有字面意义的 `PreToolUse/PostToolUse` hook，适配器用 `tools/execute` 包住真实派发，因此耗时为宿主实测值
- `trigger` 目前统一为 `model`；用户直接调用的区分需要宿主提供额外信号
- 弹窗/管理页的视觉效果与系统通知外观需在运行中的 GUI / 桌面验证；本仓库验证了路由注册、槽位注册、数据载荷与真实目录变更
- 禁用依赖 SKILL.md 的 `disable-model-invocation`；上游更新覆盖字段后需要重新开启，页面会如实显示
- 禁用后目录由 skill provider 的文件监听刷新；已加载到历史中的正文不会被撤回
- 初始扫描延迟 2.5 秒，避开启动期 skill provider 尚未注册的竞态
- 修改已安装插件的 Host 代码需要重启宿主才能加载新模块；Client 代码刷新页面即可

## License

[Apache License 2.0](LICENSE)
