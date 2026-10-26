/**
 * One decision at a time, synchronously: a second click or key press before React re-renders (or
 * while the next decision is still on its way) must not decide again. The gate opens again only when a
 * decision failed; after a success it stays shut until the inspector shows another proposal.
 */
export interface DecisionGate {
  /** True when this activation may decide; false while one runs or after one succeeded. */
  start(): boolean
  /** The decision failed: allow another try. */
  fail(): void
  /** The decision is written: stay shut until the next proposal replaces this one. */
  done(): void
  readonly state: 'idle' | 'running' | 'done'
}

export function decisionGate(): DecisionGate {
  let state: DecisionGate['state'] = 'idle'
  return {
    start() {
      if (state !== 'idle') return false
      state = 'running'
      return true
    },
    fail() {
      if (state === 'running') state = 'idle'
    },
    done() {
      state = 'done'
    },
    get state() {
      return state
    },
  }
}
