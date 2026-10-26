import { describe, expect, it } from 'vitest'
import { healthScore } from '../src/report.js'

describe('healthScore', () => {
  it('weighs tokens in sync and hard colours per file half and half', () => {
    expect(healthScore(9, 9, 0, 2)).toEqual({ score: 100, parts: { tokenSync: 1, hardValues: 1 } })
    // 5 of 9 tokens in sync, 1 hard colour in 2 files: the acme demo.
    expect(healthScore(5, 9, 1, 2).score).toBe(53)
    expect(healthScore(4, 9, 1, 2).score).toBe(47)
  })

  it('counts nothing to compare as in sync', () => {
    expect(healthScore(0, 0, 0, 0).parts).toEqual({ tokenSync: 1, hardValues: 1 })
  })
})
