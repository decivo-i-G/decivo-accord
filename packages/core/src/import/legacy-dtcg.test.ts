import { describe, expect, it } from 'vitest'
import { parseTokens } from '../dtcg/parse.js'
import { upgradeLegacyDtcg } from './legacy-dtcg.js'

describe('upgradeLegacyDtcg', () => {
  it('turns draft-notation values into DTCG 2025.10 values the parser accepts', () => {
    const doc = {
      color: {
        $type: 'color',
        brand: { $value: '#487A98' },
        overlay: { $value: 'rgba(0, 0, 0, 0.5)' },
        link: { $value: '{color.brand}' },
      },
      space: { $type: 'dimension', sm: { $value: '0.5rem' }, md: { $value: 16 } },
      motion: { fast: { $type: 'duration', $value: '150ms' } },
      weight: { bold: { $type: 'fontWeight', $value: 'Bold' }, num: { $type: 'fontWeight', $value: '600' } },
      ratio: { $type: 'number', $value: '1.5' },
      untyped: { $value: '#fff' },
    }
    expect(upgradeLegacyDtcg(doc)).toBe(9)
    const { tokens, issues } = parseTokens([{ file: 'tokens/all.tokens.json', content: doc }])
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(tokens.get('color.brand')?.value).toMatchObject({ hex: '#487a98' })
    expect(tokens.get('color.overlay')?.value).toMatchObject({ alpha: 0.5 })
    expect(tokens.get('color.link')?.aliasOf).toBe('color.brand')
    expect(tokens.get('space.md')?.value).toEqual({ value: 16, unit: 'px' })
    expect(tokens.get('weight.bold')?.value).toBe(700)
    expect(tokens.get('untyped')?.type).toBe('color')
  })

  it('leaves 2025.10 files and unreadable values untouched', () => {
    const modern = { c: { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 0] } } }
    expect(upgradeLegacyDtcg(modern)).toBe(0)
    const odd = { c: { $type: 'color', $value: 'not-a-colour' } }
    expect(upgradeLegacyDtcg(odd)).toBe(0)
    expect(odd.c.$value).toBe('not-a-colour')
  })

  it('upgrades $root tokens of a group', () => {
    const doc = { brand: { $type: 'color', $root: { $value: '#3c6681' }, light: { $value: '#eeeeee' } } }
    expect(upgradeLegacyDtcg(doc)).toBe(2)
    expect(doc.brand.$root.$value).toMatchObject({ colorSpace: 'srgb' })
  })
})
