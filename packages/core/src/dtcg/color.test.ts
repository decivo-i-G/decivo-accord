import { describe, expect, it } from 'vitest'
import { colorToCss, colorToHex, contrastRatio, cssToColor, deltaE } from './color.js'
import type { ColorValue } from './types.js'

const hex = (h: string) => cssToColor(h) as ColorValue

describe('colour conversion', () => {
  it('turns CSS hex into a DTCG sRGB colour with a hex fallback', () => {
    expect(cssToColor('#487A98')).toEqual({
      colorSpace: 'srgb',
      components: [0.2824, 0.4784, 0.5961],
      hex: '#487a98',
    })
  })

  it('round-trips hex through components when no fallback is given', () => {
    const { hex: _drop, ...withoutHex } = hex('#3c6681')
    expect(colorToHex(withoutHex as ColorValue)).toBe('#3c6681')
  })

  it('reads rgb(), hsl() and named colours', () => {
    expect(colorToHex(hex('rgb(60 102 129)'))).toBe('#3c6681')
    expect(colorToHex(hex('white'))).toBe('#ffffff')
    expect(cssToColor('rgb(0 0 0 / 50%)')?.alpha).toBe(0.5)
    expect(colorToCss(hex('rgb(0 0 0 / 50%)'))).toBe('#00000080')
  })

  it('maps DTCG HSL percentages', () => {
    const red: ColorValue = { colorSpace: 'hsl', components: [0, 100, 50] }
    expect(colorToHex(red)).toBe('#ff0000')
  })

  it('returns undefined for garbage', () => {
    expect(cssToColor('not-a-colour')).toBeUndefined()
  })
})

describe('colour metrics', () => {
  it('computes WCAG contrast of the decivo blues on white', () => {
    expect(contrastRatio(hex('#487a98'), hex('#ffffff'))).toBeCloseTo(4.65, 2)
    expect(contrastRatio(hex('#3c6681'), hex('#ffffff'))).toBeCloseTo(6.16, 2)
  })

  it('separates near misses from different colours', () => {
    expect(deltaE(hex('#487a98'), hex('#487a98'))).toBe(0)
    expect(deltaE(hex('#487a98'), hex('#4a7d9b'))).toBeLessThan(2)
    expect(deltaE(hex('#487a98'), hex('#3c6681'))).toBeGreaterThan(5)
  })
})
