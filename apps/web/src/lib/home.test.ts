import { buildRegister } from '@decivo/accord-core'
import { describe, expect, it } from 'vitest'
import { lastChangeOf, paletteOf } from './home'

/** A DTCG colour value from a hex string. */
const color = (hex: string) => ({
  colorSpace: 'srgb',
  components: [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255),
  hex,
})

const registerWith = (colors: Record<string, string>) =>
  buildRegister([
    { path: 'accord.config.yaml', content: 'version: 1\n' },
    {
      path: 'tokens/c.tokens.json',
      content: JSON.stringify({
        color: {
          $type: 'color',
          ...Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, { $value: color(v) }])),
        },
        space: { $type: 'dimension', s: { $value: { value: 4, unit: 'px' } } },
      }),
    },
  ])

describe('home: palette', () => {
  it('lists distinct colours only, without dimensions or duplicates', () => {
    const palette = paletteOf(registerWith({ a: '#ff0000', b: '#FF0000', c: '#00ff00' }))
    expect(palette).toHaveLength(2)
    // Each colour names its token, for the tooltip on the strip.
    expect(palette[0]).toMatchObject({ name: 'color.a', hex: '#ff0000' })
  })

  it('spreads a large set evenly instead of showing only its first ramp', () => {
    const colors = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`c${i}`, `#${i.toString(16).padStart(2, '0')}0000`]),
    )
    const palette = paletteOf(registerWith(colors), 4)
    expect(palette).toHaveLength(4)
    expect(new Set(palette.map((c) => c.hex)).size).toBe(4)
  })
})

describe('home: last change', () => {
  it('takes the newest of proposals, decisions and surface syncs', () => {
    const at = lastChangeOf({
      proposals: [
        { createdAt: '2026-10-20T08:00:00.000Z' },
        { createdAt: '2026-10-18T08:00:00.000Z', decision: { at: '2026-10-22T09:30:00.000Z' } },
      ],
      surfaces: { figma: { syncedAt: '2026-10-21T00:00:00.000Z' }, pen: {} },
    })
    expect(at?.toISOString()).toBe('2026-10-22T09:30:00.000Z')
  })

  it('ignores missing and invalid dates, and says nothing without any', () => {
    expect(lastChangeOf({ proposals: [{ createdAt: 'string' }, {}], surfaces: {} })).toBeUndefined()
    expect(
      lastChangeOf({
        proposals: [{ createdAt: 'string' }],
        surfaces: { code: { syncedAt: '2026-10-01T00:00:00Z' } },
      })?.toISOString(),
    ).toBe('2026-10-01T00:00:00.000Z')
  })
})
