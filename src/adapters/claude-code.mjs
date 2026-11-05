/**
 * The Claude Code adapter: PreToolUse / PostToolUse hook payloads. Used by the
 * `bin/collect.mjs` hook receiver so another host appends to the same event
 * stream with the same contract.
 */
export const ADAPTER_ID = 'claude-code-hooks'
export const HOOK_VERSION = '1'

const SKILL_TOOL_NAMES = new Set(['Skill', 'skill'])

export function createClaudeCodeAdapter({ agentVersion } = {}) {
  return {
    id: ADAPTER_ID,
    host: 'claude-code',
    hookVersion: HOOK_VERSION,
    agent: 'claude-code',
    agentVersion,
    via: 'hook',
    matches(payload) {
      return Boolean(payload) && SKILL_TOOL_NAMES.has(payload.tool_name)
    },
    skillOf(payload) {
      const input = payload?.tool_input
      const name = input?.name ?? input?.skill
      return typeof name === 'string' ? name : undefined
    },
    start(payload, capture = {}) {
      const skill = this.skillOf(payload)
      if (!skill) return null
      const phase = payload.hook_event_name ?? 'PreToolUse'
      if (phase !== 'PreToolUse') return null
      return {
        agent: this.agent,
        agent_version: this.agentVersion,
        skill,
        trigger: capture.trigger ?? 'model',
        phase: 'start',
        status: 'pending',
        session_id: String(payload.session_id ?? capture.sessionId ?? ''),
        cwd: payload.cwd ?? capture.cwd ?? process.cwd(),
        via: this.via,
        tool_use_id: payload.tool_use_id,
        prompt_hash: capture.promptHash,
        ts: capture.now,
      }
    },
    end(payload, result, capture = {}) {
      const skill = this.skillOf(payload)
      if (!skill) return null
      const phase = payload.hook_event_name ?? 'PostToolUse'
      if (phase !== 'PostToolUse') return null
      const response = payload.tool_response ?? result
      const failed = response?.is_error === true || response?.success === false ||
        (typeof response?.error === 'string' && response.error.length > 0)
      return {
        agent: this.agent,
        agent_version: this.agentVersion,
        skill,
        trigger: capture.trigger ?? 'model',
        phase: 'end',
        session_id: String(payload.session_id ?? capture.sessionId ?? ''),
        cwd: payload.cwd ?? capture.cwd ?? process.cwd(),
        via: this.via,
        tool_use_id: payload.tool_use_id,
        prompt_hash: capture.promptHash,
        ts: capture.now,
        duration_ms: capture.durationMs,
        status: failed ? 'error' : capture.aborted === true ? 'abort' : 'ok',
        error_code: failed ? 'skill_tool_error' : undefined,
      }
    },
  }
}
