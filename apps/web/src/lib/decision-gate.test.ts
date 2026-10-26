import { describe, expect, it } from 'vitest'
import { decisionGate } from './decision-gate'

describe('one decision at a time', () => {
  it('answers no second activation while a decision runs or before the next proposal opens', () => {
    const gate = decisionGate()
    const action: string[] = []
    const press = () => {
      if (gate.start()) action.push('decide')
    }
    press()
    // A second Enter or A before React re-rendered: no second call.
    press()
    expect(action).toEqual(['decide'])
    // Written: still shut while the next proposal loads.
    gate.done()
    press()
    expect(action).toEqual(['decide'])
    gate.fail()
    press()
    expect(action).toEqual(['decide'])
  })

  it('opens again after a failed decision, so the person can try once more', () => {
    const gate = decisionGate()
    expect(gate.start()).toBe(true)
    gate.fail()
    expect(gate.state).toBe('idle')
    expect(gate.start()).toBe(true)
  })
})
