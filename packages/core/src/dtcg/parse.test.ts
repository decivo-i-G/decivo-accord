import { describe, expect, it } from 'vitest'
import { parseTokens, type TokenFile } from './parse.js'
import { serializeTokens } from './serialize.js'

const srgb = (hex: string, components: [number, number, number]) => ({ colorSpace: 'srgb', components, hex })
const brand700 = srgb('#3c6681', [0.2353, 0.4, 0.5059])
const brand600 = srgb('#487a98', [0.2824, 0.4784, 0.5961])

const file = (content: unknown, name = 'tokens/color.tokens.json'): TokenFile => ({ file: name, content })
const errors = (files: TokenFile[]) => parseTokens(files).issues.filter((i) => i.severity === 'error')

describe('parseTokens', () => {
  it('reads tokens with types inherited from groups', () => {
    const { tokens, issues } = parseTokens([
      file({
        color: {
          $type: 'color',
          brand: { '600': { $value: brand600, $description: 'Markenfarbe' }, '700': { $value: brand700 } },
        },
      }),
    ])
    expect(issues).toEqual([])
    expect([...tokens.keys()]).toEqual(['color.brand.600', 'color.brand.700'])
    expect(tokens.get('color.brand.600')).toMatchObject({
      type: 'color',
      value: brand600,
      description: 'Markenfarbe',
    })
  })

  it('resolves curly-brace aliases and takes the type from the target', () => {
    const { tokens, issues } = parseTokens([
      file({
        color: { $type: 'color', brand: { '700': { $value: brand700 } } },
        semantic: { primary: { $value: '{color.brand.700}' } },
      }),
    ])
    expect(issues).toEqual([])
    expect(tokens.get('semantic.primary')).toMatchObject({
      type: 'color',
      value: brand700,
      aliasOf: 'color.brand.700',
    })
  })

  it('resolves aliases inside composite values and across files', () => {
    const { tokens, issues } = parseTokens([
      file({ color: { $type: 'color', ink: { $value: srgb('#16222b', [0.0863, 0.1333, 0.1686]) } } }),
      file(
        {
          border: {
            focus: {
              $type: 'border',
              $value: { color: '{color.ink}', width: { value: 2, unit: 'px' }, style: 'solid' },
            },
          },
        },
        'tokens/border.tokens.json',
      ),
    ])
    expect(issues).toEqual([])
    expect(tokens.get('border.focus')?.value).toMatchObject({ color: { hex: '#16222b' } })
    expect(tokens.get('border.focus')?.file).toBe('tokens/border.tokens.json')
  })

  it('resolves JSON Pointer $ref down to a single component', () => {
    const { tokens, issues } = parseTokens([
      file({
        color: {
          $type: 'color',
          base: { $value: brand700 },
          derived: {
            $value: {
              colorSpace: 'srgb',
              components: [{ $ref: '#/color/base/$value/components/0' }, 0.5, 0.5],
            },
          },
        },
      }),
    ])
    expect(issues).toEqual([])
    expect(tokens.get('color.derived')?.value).toMatchObject({ components: [0.2353, 0.5, 0.5] })
  })

  it('supports $root tokens and references to them', () => {
    const { tokens, issues } = parseTokens([
      file({
        color: {
          $type: 'color',
          accent: { $root: { $value: brand600 }, light: { $value: brand700 } },
          link: { $value: '{color.accent.$root}' },
        },
      }),
    ])
    expect(issues).toEqual([])
    expect(tokens.get('color.accent.$root')?.value).toEqual(brand600)
    expect(tokens.get('color.link')?.value).toEqual(brand600)
  })

  it('inherits tokens and type through $extends, local definitions win', () => {
    const { tokens, groups, issues } = parseTokens([
      file({
        button: {
          $type: 'color',
          bg: { $value: brand700 },
          fg: { $value: srgb('#ffffff', [1, 1, 1]) },
        },
        'button-brand': { $extends: '{button}', bg: { $value: brand600 } },
      }),
    ])
    expect(issues).toEqual([])
    expect(tokens.get('button-brand.bg')?.value).toEqual(brand600)
    expect(tokens.get('button-brand.bg')?.inheritedFrom).toBeUndefined()
    expect(tokens.get('button-brand.fg')).toMatchObject({ type: 'color', inheritedFrom: 'button.fg' })
    expect(groups.get('button-brand')?.type).toBeUndefined()
  })

  it('applies group deprecation to its tokens', () => {
    const { tokens } = parseTokens([
      file({
        color: { $type: 'color', legacy: { $deprecated: 'Use color.brand', blue: { $value: brand600 } } },
      }),
    ])
    expect(tokens.get('color.legacy.blue')?.deprecated).toBe('Use color.brand')
  })

  it('reads Accord metadata from $extensions and keeps unknown vendors', () => {
    const { tokens, groups, issues } = parseTokens([
      file({
        color: {
          $type: 'color',
          $extensions: { 'de.decivo.accord': { owner: 'design' } },
          focus: {
            $value: brand600,
            $extensions: {
              'de.decivo.accord': { owner: 'code', decisions: ['D-012'] },
              'com.example': { keep: true },
            },
          },
        },
      }),
    ])
    expect(issues).toEqual([])
    expect(groups.get('color')?.accord).toEqual({ owner: 'design' })
    expect(tokens.get('color.focus')?.accord).toEqual({ owner: 'code', decisions: ['D-012'] })
    expect(tokens.get('color.focus')?.extensions?.['com.example']).toEqual({ keep: true })
  })

  describe('reports errors', () => {
    it('for a colour written as a hex string (pre-2025.10 style)', () => {
      expect(errors([file({ c: { $type: 'color', $value: '#487a98' } })])).toMatchObject([
        { code: 'invalid-value', path: 'c', message: expect.stringContaining('not a string') },
      ])
    })

    it('for tokens without any type', () => {
      expect(errors([file({ spacing: { lg: { $value: { value: 24, unit: 'px' } } } })])).toMatchObject([
        { code: 'missing-type', path: 'spacing.lg' },
      ])
    })

    it('for forbidden names', () => {
      expect(errors([file({ color: { $type: 'color', 'brand.700': { $value: brand700 } } })])).toMatchObject([
        { code: 'invalid-name', path: 'color.brand.700' },
      ])
    })

    it('for broken references and cycles', () => {
      expect(errors([file({ a: { $type: 'color', $value: '{nope}' } })])).toMatchObject([
        { code: 'broken-reference' },
      ])
      const cycle = errors([file({ x: { $type: 'number', a: { $value: '{x.b}' }, b: { $value: '{x.a}' } } })])
      expect(cycle.some((i) => i.code === 'reference-cycle')).toBe(true)
    })

    it('for an invalid owner', () => {
      expect(
        errors([
          file({
            c: { $type: 'number', $value: 1, $extensions: { 'de.decivo.accord': { owner: 'marketing' } } },
          }),
        ]),
      ).toMatchObject([{ code: 'accord-owner' }])
    })

    it('for the same token in two files', () => {
      const a = file({ c: { $type: 'number', $value: 1 } }, 'tokens/a.tokens.json')
      const b = file({ c: { $type: 'number', $value: 2 } }, 'tokens/b.tokens.json')
      expect(errors([a, b])).toMatchObject([{ code: 'duplicate-token', file: 'tokens/b.tokens.json' }])
    })

    it('for out-of-range values', () => {
      const issues = errors([
        file({
          w: { $type: 'fontWeight', $value: 1200 },
          d: { $type: 'dimension', $value: { value: 1, unit: 'em' } },
          e: { $type: 'cubicBezier', $value: [2, 0, 1, 1] },
        }),
      ])
      expect(issues.map((i) => i.path).sort()).toEqual(['d', 'e', 'w'])
    })
  })
})

describe('serializeTokens', () => {
  it('round-trips documents, leaving out what groups and $extends imply', () => {
    const original = {
      $extensions: { 'de.decivo.accord': { owner: 'design' } },
      color: {
        $type: 'color',
        brand: { '600': { $value: brand600 }, '700': { $value: brand700, $deprecated: 'Use brand.600' } },
        primary: { $value: '{color.brand.700}' },
      },
      button: { $type: 'color', bg: { $value: brand700 } },
      'button-brand': { $extends: '{button}', bg: { $value: brand600 } },
      size: { lg: { $type: 'dimension', $value: { value: 24, unit: 'px' } } },
    }
    const { tokens, groups, issues } = parseTokens([file(original)])
    expect(issues).toEqual([])
    const docs = serializeTokens(tokens, groups)
    expect(docs.get('tokens/color.tokens.json')).toEqual(original)
  })
})
