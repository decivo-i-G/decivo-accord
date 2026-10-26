import { parseTokens } from '@decivo/accord-core'
import { describe, expect, it } from 'vitest'
import { designTokenType, tokensFromDesign } from './design-tokens.js'

describe('designTokenType', () => {
  it('reads Figma scopes before names', () => {
    expect(designTokenType({ name: 'a', type: 'float', scopes: ['CORNER_RADIUS'], value: 4 })).toBe(
      'dimension',
    )
    expect(designTokenType({ name: 'a', type: 'float', scopes: ['FONT_WEIGHT'], value: 700 })).toBe(
      'fontWeight',
    )
    expect(designTokenType({ name: 'a', type: 'float', scopes: ['OPACITY'], value: 50 })).toBe('number')
    expect(designTokenType({ name: 'a', type: 'string', scopes: ['FONT_FAMILY'], value: 'Inter' })).toBe(
      'fontFamily',
    )
  })

  it('falls back to the name for unscoped numbers and skips text and booleans', () => {
    expect(designTokenType({ name: 'spacing.4', type: 'float', scopes: ['ALL_SCOPES'], value: 16 })).toBe(
      'dimension',
    )
    expect(designTokenType({ name: 'z-index.modal', type: 'number', value: 50 })).toBe('number')
    expect(designTokenType({ name: 'motion.duration.fast', type: 'number', value: 150 })).toBe('duration')
    expect(designTokenType({ name: 'label', type: 'string', value: 'Hello' })).toBeUndefined()
    expect(designTokenType({ name: '--font-sans', type: 'string', value: 'Inter' })).toBe('fontFamily')
    expect(designTokenType({ name: 'Font Family.Body', type: 'string', value: 'Inter' })).toBe('fontFamily')
    expect(designTokenType({ name: 'Weight Bold', type: 'string', value: 'Bold' })).toBe('fontWeight')
    expect(
      designTokenType({ name: 'Weight Light Italic', type: 'string', value: 'Light Italic' }),
    ).toBeUndefined()
    expect(designTokenType({ name: 'Duration.Fast', type: 'string', value: '150ms' })).toBe('duration')
    expect(designTokenType({ name: 'Easing.Out', type: 'string', value: '[0,0,0,1]' })).toBe('cubicBezier')
    expect(designTokenType({ name: 'flag', type: 'boolean', value: true })).toBeUndefined()
    expect(designTokenType({ name: 'r', type: 'borderRadius', value: '4px' })).toBe('dimension')
  })
})

describe('tokensFromDesign', () => {
  it('builds valid DTCG files with register names, aliases and the tool name in ids', () => {
    const { files, skipped } = tokensFromDesign(
      [
        { name: 'Color.Blue.500', segments: ['Color', 'Blue', '500'], type: 'color', value: '#3c6681' },
        {
          name: 'Color.Primary',
          segments: ['Color', 'Primary'],
          type: 'color',
          value: '#3c6681',
          alias: 'Color.Blue.500',
          cssVariable: '--brand-primary',
        },
        {
          name: '⭕️ Border radius.Rounded',
          segments: ['⭕️ Border radius', 'Rounded'],
          type: 'float',
          scopes: ['CORNER_RADIUS'],
          value: 4,
        },
        { name: 'Spacing.0.5', segments: ['Spacing', '0.5'], type: 'float', value: 2 },
        { name: 'Motion.Ease', type: 'string', value: 'cubic-bezier(0.4, 0, 0.2, 1)' },
        { name: 'Color.Muted', type: 'color', value: '#eeeeee', alias: 'Color.Blue.500' },
        { name: 'Copy.Title', segments: ['Copy', 'Title'], type: 'string', value: 'Welcome' },
        { name: 'Color.Blue.500', segments: ['Color', 'Blue', '500'], type: 'color', value: '#000000' },
        { name: 'Color.Ghost', type: 'color', value: undefined },
      ],
      'figma',
    )
    const { tokens, issues } = parseTokens(files)
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(files.map((f) => f.file).sort()).toEqual([
      'tokens/border-radius.tokens.json',
      'tokens/color.tokens.json',
      'tokens/motion.tokens.json',
      'tokens/spacing.tokens.json',
    ])
    expect(tokens.get('color.primary')?.value).toEqual(tokens.get('color.blue.500')?.value)
    expect(tokens.get('color.primary')?.accord?.ids).toEqual({
      figma: 'Color.Primary',
      css: '--brand-primary',
    })
    expect(tokens.get('border-radius.rounded')?.value).toEqual({ value: 4, unit: 'px' })
    expect(tokens.get('spacing.0_5')?.value).toEqual({ value: 2, unit: 'px' })
    const colors = files.find((f) => f.file === 'tokens/color.tokens.json')?.content as {
      color: { primary: { $value: unknown } }
    }
    expect(colors.color.primary.$value).toBe('{color.blue.500}')
    // An alias that resolves to another value (another mode of the target collection) keeps its own value.
    expect(tokens.get('color.muted')?.aliasOf).toBeUndefined()
    expect(tokens.get('motion.ease')?.value).toEqual([0.4, 0, 0.2, 1])
    expect(skipped).toEqual([
      { name: 'Copy.Title', reason: 'type' },
      { name: 'Color.Blue.500', reason: 'duplicate' },
      { name: 'Color.Ghost', reason: 'value' },
    ])
  })

  it('puts bare names into the group of their type and turns a token that is also a group into $root', () => {
    const { files } = tokensFromDesign(
      [
        { name: '--primary', type: 'color', value: '#3c6681', cssVariable: '--primary' },
        { name: 'radius', type: 'number', value: 8 },
        { name: 'brand', type: 'color', value: '#111111' },
        { name: 'color.brand.light', type: 'color', value: '#eeeeee' },
      ],
      'pen',
    )
    const { tokens, issues } = parseTokens(files)
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
    expect([...tokens.keys()].sort()).toEqual([
      'color.brand.$root',
      'color.brand.light',
      'color.primary',
      'dimension.radius',
    ])
    expect(tokens.get('color.brand.$root')?.accord?.ids).toEqual({ pen: 'brand' })
  })
})
