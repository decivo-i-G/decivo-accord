import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseTokens } from '../dtcg/parse.js'
import { importTokensStudio } from './tokens-studio.js'

const decivo = JSON.parse(
  readFileSync(new URL('../../test/fixtures/decivo/tokens.studio.json', import.meta.url), 'utf8'),
) as unknown

const firstFile = (result: { files: { content: unknown }[] }): unknown => {
  const file = result.files[0]
  if (!file) throw new Error('no file produced')
  return file.content
}

describe('importTokensStudio', () => {
  it('converts colours, rgba, dimensions and DEFAULT → $root', () => {
    const result = importTokensStudio({
      global: {
        color: {
          brand: {
            DEFAULT: { value: '#487a98', type: 'color', description: 'Markenfarbe' },
            hover: { value: '{color.brand.DEFAULT}', type: 'color' },
          },
          scrim: { value: 'rgba(22,27,31,0.32)', type: 'color' },
        },
        radius: { md: { value: '0.5rem', type: 'borderRadius' } },
      },
    })
    expect(result.issues).toEqual([])
    expect(result.renamed.get('color.brand.DEFAULT')).toBe('color.brand.$root')
    expect(result.files.map((f) => f.file)).toEqual(['tokens/color.tokens.json', 'tokens/radius.tokens.json'])
    expect(result.files[0]?.content).toEqual({
      color: {
        $type: 'color',
        brand: {
          $root: {
            $value: { colorSpace: 'srgb', components: [0.2824, 0.4784, 0.5961], hex: '#487a98' },
            $description: 'Markenfarbe',
          },
          hover: { $value: '{color.brand.$root}' },
        },
        scrim: {
          $value: { colorSpace: 'srgb', components: [0.0863, 0.1059, 0.1216], hex: '#161b1f', alpha: 0.32 },
        },
      },
    })
  })

  it('keeps fluid sizes as CSS and approximates the DTCG value', () => {
    const result = importTokensStudio({
      typography: {
        h1: {
          type: 'typography',
          value: {
            fontFamily: 'Merriweather',
            fontSize: 'clamp(2.5rem, 5vw, 3.5rem)',
            lineHeight: '1.1',
            fontWeight: '700',
          },
        },
      },
    })
    const h1 = (firstFile(result) as { typography: { h1: Record<string, unknown> } }).typography.h1
    expect(h1.$value).toEqual({
      fontFamily: 'Merriweather',
      fontSize: { value: 3.5, unit: 'rem' },
      fontWeight: 700,
      letterSpacing: { value: 0, unit: 'px' },
      lineHeight: 1.1,
    })
    expect(h1.$extensions).toEqual({
      'de.decivo.accord': { css: { fontSize: 'clamp(2.5rem, 5vw, 3.5rem)' } },
    })
    expect(result.issues.map((i) => i.code)).toEqual(['import-approximated', 'import-approximated'])
  })

  it('parses multi-layer box shadows', () => {
    const result = importTokensStudio({
      shadow: {
        card: { type: 'boxShadow', value: '0 1px 3px rgba(0,0,0,0.04), 0 4px 8px rgba(0,0,0,0.03)' },
      },
    })
    expect(result.issues).toEqual([])
    const card = (firstFile(result) as { shadow: { card: { $value: unknown[] } } }).shadow.card
    expect(card.$value).toHaveLength(2)
    expect(card.$value[0]).toMatchObject({
      offsetY: { value: 1, unit: 'px' },
      blur: { value: 3, unit: 'px' },
      color: { alpha: 0.04 },
    })
  })

  it('skips what DTCG cannot express, with a reason', () => {
    const result = importTokensStudio({
      a: { value: '{b} * 2', type: 'spacing' },
      c: { value: '50%', type: 'sizing' },
      d: { value: 'x', type: 'asset' },
    })
    expect(result.files).toEqual([])
    expect(result.issues.map((i) => [i.path, i.code])).toEqual([
      ['a', 'import-unsupported'],
      ['c', 'import-approximated'],
      ['d', 'import-unsupported'],
    ])
  })

  describe("decivo's tokens.json (pilot 0, internal names neutralised)", () => {
    const result = importTokensStudio(decivo)

    it('imports every token without errors', () => {
      expect(result.issues.filter((i) => i.severity === 'error')).toEqual([])
      const { tokens } = parseTokens(result.files)
      expect(tokens.size).toBe(128)
    })

    it('only warns about fluid sizes and missing letter spacing', () => {
      const warnings = result.issues.filter((i) => i.severity === 'warning')
      expect(new Set(warnings.map((w) => w.code))).toEqual(new Set(['import-approximated']))
    })

    it('keeps both blues: brand-700 and the brand colour', () => {
      const { tokens } = parseTokens(result.files)
      const hex = (path: string) => (tokens.get(path)?.value as { hex?: string } | undefined)?.hex
      expect(hex('color.admin.brand-700')).toBe('#3c6681')
      expect(hex('color.brand.$root')).toBe('#487a98')
    })
  })
})

describe('token sets', () => {
  it('merges sets in $metadata.tokenSetOrder and reports clashes', () => {
    const result = importTokensStudio({
      $metadata: { tokenSetOrder: ['core', 'brand'] },
      core: { size: { s: { value: '4px', type: 'spacing' } } },
      brand: { size: { s: { value: '8px', type: 'spacing' }, m: { value: '16px', type: 'spacing' } } },
    })
    expect(result.issues.map((i) => [i.path, i.code])).toEqual([['size.s', 'import-duplicate']])
    expect(Object.keys((firstFile(result) as { size: object }).size)).toEqual(['$type', 's', 'm'])
  })
})
