/**
 * The facade is deliberately thin: adapters hand it contract input and it calls
 * `makeEvent()` exactly once. This is the only place host events become
 * SkillHealth events, which is what `test/adapter-parity.test.mjs` pins down.
 */
import { makeEvent } from './event.mjs'

export function createFacade(adapter) {
  return Object.freeze({
    adapterId: adapter.id,
    host: adapter.host,
    start(native, capture) {
      const raw = adapter.start(native, capture)
      return raw === null || raw === undefined ? null : makeEvent(raw)
    },
    end(native, result, capture) {
      const raw = adapter.end(native, result, capture)
      return raw === null || raw === undefined ? null : makeEvent(raw)
    },
  })
}

export { makeEvent }
