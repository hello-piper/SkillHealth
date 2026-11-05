# SkillHealth

**English** | [中文](README.zh.md)

SkillHealth is a DeepSeek Harness (DSH) plugin that records skill invocations and answers three questions: is a skill actually used, how well does it perform, and should the library be tidied up?

## Features

- **One event stream across hosts** — DSH `tools/execute` and Claude Code `PreToolUse/PostToolUse` hooks append to the same JSONL file
- **Pairing and de-duplication** — `session_id + tool_use_id`, falling back to `skill + 60s` when no tool id exists
- **Rebuildable SQLite artifacts** — delete `index.sqlite3` / `rollup.sqlite3`; both are rebuilt from `events/`
- **Health diagnostics** — six rules plus a weighted score (coverage / success / freshness / redundancy)
- **Restrained reminders** — terminal line, native notification, and in-app popup; at most once per session, with ignore/dismiss
- **Standard opt-out** — reads and writes the Agent Skills `disable-model-invocation` frontmatter field
- **Management page** — advice, all skills, and trend views with search, detail expansion, and default-load switches
- **Local by design** — metadata only, no remote upload

## Install

```bash
git clone https://github.com/hello-piper/dsh-skillhealth.git
```

Install the cloned directory as a DSH bundle:

- use Plugin Manager → install from a local directory, or
- ask the agent to call `plugin_manager` with `action: install_bundle` and the absolute path as `target`

Restart the host after installing so the Host module loads; refresh the Client page after client changes. The default data root is `~/.agents/_skill-usage-stats`.

## Data layout

```
~/.agents/_skill-usage-stats/
├── events/YYYY-MM-DD.jsonl   # append-only, shared by all hosts, each line carries agent
├── index.sqlite3              # paired/de-duplicated index (safe to delete, rebuildable)
├── rollup.sqlite3             # daily/skill/agent aggregates + health snapshots (rebuildable)
├── collector.log              # discarded events, schema errors, notification failures, [host] prefix
└── agents/<host>/
    ├── health.json             # latest health snapshot
    ├── health-state.json       # last scan, last score, last rebuild
    ├── config.toml             # per-host collection / health / notification thresholds
    ├── notify.json             # throttling, silence, dismissed rules, reminded sessions
    └── install.json            # integration mode and hook version
```

Deleting `index.sqlite3` / `rollup.sqlite3` only loses cache; deleting `events/` is the real data loss. Filter by host with `SELECT ... WHERE agent = ?`; no separate databases are needed.

## Event contract

`src/core/event.mjs` owns the field set; facades may only produce events through `makeEvent()`:

- Required: `id ts schema agent skill trigger phase session_id cwd via status`
- Optional: `tool_use_id prompt_hash duration_ms error_code agent_version`
- `phase ∈ {start, end}`; `start` is always `pending`; `end` is `ok|error|abort`
- Unknown fields throw, so no host can add a field behind another host's back
- `id` is derived from `agent + session_id + (tool_use_id | skill+second) + phase`, so replay is idempotent

Host differences stay in `src/adapters/`:

| Adapter | Entry point | `via` |
|---|---|---|
| `dsh.mjs` | `tools/execute` around the real `skill` tool dispatch | `tool-event` |
| `claude-code.mjs` | `PreToolUse` / `PostToolUse` hooks via `bin/collect.mjs` | `hook` |

`test/adapter-parity.test.mjs` asserts both adapters produce the same field set and covers unknown fields, invalid phase/status, and deterministic ids.

## Pairing

Merge key = `session_id + tool_use_id`; without a tool id it degrades to `skill + 60s` window.

- No end after 30 minutes → the start is marked `abort` (killed process / user interruption)
- An orphan start younger than 30 minutes stays `pending` and is resolved by a later rebuild
- An end with no start is written to `collector.log`
- Duplicate events are de-duplicated by `id`

## Aggregate tables

`index.sqlite3`: `calls` (paired results), `event_seen` (idempotence), `meta`.

`rollup.sqlite3`:

| Table | Primary key | Purpose |
|---|---|---|
| `rollup_daily` | day, agent, skill | trend, ranking, p50/p95 |
| `skill_meta` | skill | first/last use, install path, description fingerprint |
| `cooccur` | session_id, skill_a, skill_b | same-session co-occurrence |
| `health_snapshot` | scanned_at | score, four dimensions, issue JSON |

The UI never scans all JSONL: the popup and `/skillhealth` read `health.json` + `rollup`; the weekly report reads only the last 7 days of `rollup_daily`.

## Health rules

Six rules; each hit produces one issue:

| Rule | Condition | Suggested action |
|---|---|---|
| Never used | installed > 30 days and 0 calls | archive |
| Stale | last use > 60 days and < 3 calls total | archive |
| Duplicate | description similarity ≥ 0.8 and same category | merge |
| Broken path | SKILL.md or a relative dependency is missing | fix / delete |
| High failure | ≥ 10 calls and failure rate > 15% | investigate |
| Trigger conflict | keyword overlap and ≥ 3 same-session co-occurrences | rewrite description |

Health score = coverage 35% + success 25% + freshness 25% + redundancy 15%, each dimension 0–100.
“Category” comes from the skill source (project / user / runtime / bundled / custom). Trigger conflict is a keyword-overlap + co-occurrence heuristic; it does not read the model's real routing.

## Reminders

Triggered when health < 75 or issues ≥ 10, outside a silence window. Reminders stop automatically once health returns to 80+, and the weekly report records the recovery.

All three channels share one message:

- Terminal: one stderr line on the first turn, never added to model context
- Native notification: macOS `osascript`; Linux `notify-send`; failures only go to `collector.log`
- In-app popup: `shell.overlay` card, at most 3 suggested skills, selectable for disabling
- Management page: sidebar `SkillHealth` icon opens a `main` panel with advice, all skills, and trend views

Restraint:

1. At most one reminder per session; `notify.json` records reminded sessions
2. “Ignore this week” silences for 14 days; “Close” disables the current rule class, weekly reports continue
3. Health ≥ 80 stops reminders automatically; native notifications have a 24-hour cooldown

## Default loading and disabling

The “default load” switch reads and writes the standard Agent Skills field in `SKILL.md`:

```yaml
---
name: your-skill
description: ...
disable-model-invocation: true
---
```

- `true`: DSH's skill provider sets `modelInvocable` to false; the model catalog and `skill` tool no longer expose it
- Users can still invoke it explicitly with `/your-skill` (`user-invocable` defaults to true)
- Turning the switch off writes `false`, preserving the rest of the frontmatter and the file mode
- Runtime/remote skills without a file path are shown as not editable
- The management page reads `SKILL.md` on every refresh, so an upstream overwrite or a manual edit is reflected truthfully
- `skills update` can overwrite the field; this is a known trade-off and the page will show the skill as enabled

## Privacy

- Metadata only: skill name, duration, status, cwd, and the first 8 hex characters of a prompt sha1
- No prompts, responses, or file contents are stored
- `$HOME` in cwd is folded to `~`
- Nothing is uploaded; native notifications stay local

## Configuration

Each host has `agents/<host>/config.toml`; patch `config.notify` overrides notification switches, other values come from the file.

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

## Usage

- `/skillhealth`: print score, four dimensions, rule hits, and advice
- `GET /skill-usage-stats/api/state?session=<id>`: popup payload with up to 3 suggestions (same-origin cookie required)
- `GET /skill-usage-stats/api/manage`: full skill list, call stats, 30-day trend, issues
- `POST /skill-usage-stats/api/skills`: `{"skill":"name","enabled":false}` or `{"skills":[...],"enabled":false}`
- `POST /skill-usage-stats/api/action`: `{"action":"ignore"|"close"|"reset"|"refresh","rule?":...,"session":...}`
- `GET /skill-usage-stats/api/weekly`: weekly report

## Tests

```bash
cd dsh-skillhealth
npm test
```

Covers contract parity, pairing/timeout/idempotence, six rules, four dimensions, reminder gating, copy, collector writes and rebuild-after-delete, health actions, and `disable-model-invocation` read/write with file state overriding a stale provider cache.

## Known limits

- DSH has no literal `PreToolUse/PostToolUse` hook; the adapter wraps the real dispatch with `tools/execute`, so duration is host-measured
- `trigger` is currently always `model`; distinguishing direct user invocation needs an extra host signal
- The popup/management page visuals and native notification appearance need a live GUI/desktop check; this repo verifies routes, slots, payloads, and real directory changes
- Disabling depends on the `disable-model-invocation` field; an upstream update can overwrite it, and the page will show the truth
- The catalog refreshes through the skill provider's file watch; already-loaded content in history is not retracted
- The initial scan is delayed 2.5s to avoid the boot-time provider race
- Host code changes need a host restart; Client code changes need a page refresh

## License

[Apache License 2.0](LICENSE)
