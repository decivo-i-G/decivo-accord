import { describe, expect, it } from 'vitest'
import { cssToDimension, cssToShadow, dimensionToPx, evaluateCalc, splitTopLevel } from './css-values.js'

describe('css values', () => {
  it('splits on top-level separators only', () => {
    expect(splitTopLevel('0 1px rgba(0, 0, 0, .1), inset 0 0 1px red', ',')).toEqual([
      '0 1px rgba(0, 0, 0, .1)',
      'inset 0 0 1px red',
    ])
  })

  it('reads px/rem dimensions and rejects other units', () => {
    expect(cssToDimension('24px')).toEqual({ value: 24, unit: 'px' })
    expect(cssToDimension('.5rem')).toEqual({ value: 0.5, unit: 'rem' })
    expect(cssToDimension('0')).toEqual({ value: 0, unit: 'px' })
    expect(cssToDimension('1em')).toBeUndefined()
    expect(dimensionToPx({ value: 1.5, unit: 'rem' })).toBe(24)
  })

  it('reads inset shadows and rejects nonsense', () => {
    expect(cssToShadow('inset 0 0 0 1px #fff')).toEqual([
      {
        inset: true,
        color: { colorSpace: 'srgb', components: [1, 1, 1], hex: '#ffffff' },
        offsetX: { value: 0, unit: 'px' },
        offsetY: { value: 0, unit: 'px' },
        blur: { value: 0, unit: 'px' },
        spread: { value: 1, unit: 'px' },
      },
    ])
    expect(cssToShadow('none')).toBeUndefined()
  })
  it('evaluates simple calc() expressions', () => {
    expect(cssToDimension('calc(0.625rem * 0.6)')).toEqual({ value: 0.375, unit: 'rem' })
    expect(evaluateCalc('calc((8px + 4px) * 2)')).toEqual({ value: 24, unit: 'px' })
    expect(evaluateCalc('calc(1rem / 2)')).toEqual({ value: 0.5, unit: 'rem' })
    expect(evaluateCalc('calc(1rem + 4px)')).toBeUndefined()
    expect(evaluateCalc('calc(100% - 2rem)')).toBeUndefined()
    expect(evaluateCalc('calc(2 * 3)')).toBeUndefined()
    expect(evaluateCalc('calc(1rem * 10vw)')).toBeUndefined()
  })
})
