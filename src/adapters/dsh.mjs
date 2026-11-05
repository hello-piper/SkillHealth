/**
 * The DSH adapter: skill usage arrives on the tool-dispatch pipeline, not on a
 * PreToolUse/PostToolUse hook pair. Registration and payload differences stop
 * here; the facade sees only contract input.
 */
const DSH_SKILL_TOOL = 'skill'

export const ADAPTER_ID = 'dsh-tool-events'
export const HOOK_VERSION = '1'

export function createDshAdapter({ agentVersion } = {}) {
  return {
    id: ADAPTER_ID,
    host: 'dsh',
    hookVersion: HOOK_VERSION,
    agent: 'dsh',
    agentVersion,
    via: 'tool-event',
    /** Whether one dispatch belongs to the skill tool. */
    matches(exec) {
      return Boolean(exec) && exec.name === DSH_SKILL_TOOL
    },
    /** The skill name from the tool arguments, or undefined. */
    skillOf(exec) {
      const args = exec?.arguments
      return typeof args?.name === 'string' ? args.name : undefined
    },
    start(exec, capture = {}) {
      const skill = this.skillOf(exec)
      if (!skill) return null
      return {
        agent: this.agent,
        agent_version: this.agentVersion,
        skill,
        trigger: capture.trigger ?? 'model',
        phase: 'start',
        status: 'pending',
        session_id: String(capture.sessionId ?? exec.agent?.id ?? ''),
        cwd: capture.cwd ?? process.cwd(),
        via: this.via,
        tool_use_id: exec.callId === undefined ? undefined : String(exec.callId),
        prompt_hash: capture.promptHash,
        ts: capture.now,
      }
    },
    end(exec, result, capture = {}) {
      const skill = this.skillOf(exec)
      if (!skill) return null
      const failed = Boolean(result?.isError)
      const aborted = !failed && Boolean(exec?.signal?.aborted)
      // `exec.signal` is the live caller signal; the runtime may replace a
      // successful result with the canonical cancellation after listeners run.
      const protocolAbort = !failed && capture.protocolAbort === true
      return {
        agent: this.agent,
        agent_version: this.agentVersion,
        skill,
        trigger: capture.trigger ?? 'model',
        phase: 'end',
        session_id: String(capture.sessionId ?? exec.agent?.id ?? ''),
        cwd: capture.cwd ?? process.cwd(),
        via: this.via,
        tool_use_id: exec.callId === undefined ? undefined : String(exec.callId),
        prompt_hash: capture.promptHash,
        ts: capture.now,
        duration_ms: capture.durationMs,
        status: failed ? 'error' : aborted || protocolAbort ? 'abort' : 'ok',
        error_code: failed ? failureCode(result) : undefined,
      }
    },
  }
}

function failureCode(result) {
  return result?.error?.info?.code ?? result?.error?.name ?? 'tool_error'
}
