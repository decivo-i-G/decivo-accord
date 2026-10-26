import { fileURLToPath } from 'node:url'
import { formatValue } from '@decivo/accord-core'
import { loadRegister } from '@decivo/accord-core/node'
import { describe, expect, it } from 'vitest'
import { scanCode } from './scan.js'

const root = fileURLToPath(new URL('../test/fixtures/repo', import.meta.url))

describe('scanCode', async () => {
  const register = await loadRegister(`${root}/.accord`)
  const scan = await scanCode({ root, register })

  it('loads the fixture register cleanly', () => {
    expect(register.issues).toEqual([])
  })

  it('reads token values from CSS variables, honouring ids.css and the naming convention', () => {
    const values = Object.fromEntries(
      [...scan.snapshot.tokens].map(([path, t]) => [path, formatValue(t.type, t.value)]),
    )
    expect(values).toEqual({
      'color.brand.$root': '#487a98',
      'color.brand.700': '#3c6681',
      'spacing.lg': '1.5rem',
    })
    // `--text-primary` does not follow the convention (`--color-text-primary`) and has no ids.css.
    expect(scan.missing).toEqual(['color.text.primary', 'spacing.xl', 'radius.md'])
    expect(scan.unreadable).toEqual([
      { path: 'font.hero', variable: '--hero-size', value: 'clamp(2rem, 5vw, 3.5rem)' },
    ])
    expect(scan.snapshot.coverage.tokens).not.toContain('font.hero')
  })

  it('lists colour variables without a token, with candidates', () => {
    // --color-brand and --color-primary are aliases of token variables, so they belong to those tokens.
    expect(scan.unmapped.map((u) => [u.variable.name, u.match.exact])).toEqual([
      ['--text-primary', ['color.text.primary']],
      ['--legacy-teal', []],
    ])
  })

  it('finds hard values in components and stylesheets and maps them to tokens', () => {
    const rows = scan.hardValues.map((h) => {
      const m = h.match.exact[0] ?? (h.match.near ? `≈${h.match.near.path}` : '–')
      return `${h.file}:${h.line} ${h.raw} → ${m}`
    })
    expect(rows).toEqual([
      'src/app/globals.css:22 rgba(72, 122, 152, 0.3) → –',
      'src/components/Hero.tsx:4 #487a98 → color.brand.$root',
      'src/components/Hero.tsx:9 #487A98 → color.brand.$root',
      'src/components/Hero.tsx:9 13px → –',
      'src/components/Hero.tsx:9 rgba(0,0,0,0.5) → –',
      'src/components/Hero.tsx:10 #4a7d9b → ≈color.brand.$root',
      'src/components/Hero.tsx:10 24 → spacing.lg',
      'src/components/Hero.tsx:10 8px → radius.md',
      'src/components/Hero.tsx:10 #16222b → color.text.primary',
      'src/components/Hero.tsx:10 #3c6681 → color.brand.700',
      'src/emails/welcome.ts:1 #487a98 → color.brand.$root',
      'src/emails/welcome.ts:1 #ffffff → –',
    ])
    expect(scan.filesScanned).toBe(3)
    expect(scan.hardValues.filter((h) => h.allowed).map((h) => `${h.raw} ${h.allowed}`)).toEqual([
      '#16222b Fremdmarke im Logo',
    ])
    expect(scan.hardValues.filter((h) => h.inlineOnly).map((h) => `${h.file} ${h.raw}`)).toEqual([
      'src/emails/welcome.ts #487a98',
      'src/emails/welcome.ts #ffffff',
    ])
  })
})

describe('matching', () => {
  it('prefers tokens whose name shares words with the variable', async () => {
    const { buildTokenIndex, matchColor } = await import('./match.js')
    const { cssToColor, parseTokens } = await import('@decivo/accord-core')
    const blue = { colorSpace: 'srgb', components: [0.2824, 0.4784, 0.5961], hex: '#487a98' }
    const { tokens } = parseTokens([
      {
        file: 't',
        content: {
          color: { $type: 'color', chart: { '1': { $value: blue } }, brand: { $root: { $value: blue } } },
        },
      },
    ])
    const index = buildTokenIndex(tokens.values())
    const color = cssToColor('#487a98')
    if (!color) throw new Error('colour')
    expect(matchColor(index, color, 5).exact).toEqual(['color.chart.1', 'color.brand.$root'])
    expect(matchColor(index, color, 5, '--brand-blue').exact).toEqual(['color.brand.$root', 'color.chart.1'])
  })

  it('suggests a token whose CSS variable the code defines before one whose variable does not exist', async () => {
    const { buildTokenIndex, matchColor } = await import('./match.js')
    const { cssToColor, parseTokens } = await import('@decivo/accord-core')
    const blue = { colorSpace: 'srgb', components: [0.2353, 0.4, 0.5059], hex: '#3c6681' }
    const { tokens } = parseTokens([
      {
        file: 't',
        content: {
          blue: { '600': { $type: 'color', $value: blue } },
          color: { brand: { $type: 'color', $value: '{blue.600}' } },
        },
      },
    ])
    const color = cssToColor('#3c6681')
    if (!color) throw new Error('colour')
    // Referenced by the brand colour, the primitive wins while both variables would work …
    expect(matchColor(buildTokenIndex(tokens.values()), color, 5).exact[0]).toBe('blue.600')
    // … but the code only defines --brand, so var(--blue-600) would be a broken suggestion.
    const index = buildTokenIndex(tokens.values(), new Map(), new Set(['color.brand']))
    expect(matchColor(index, color, 5).exact[0]).toBe('color.brand')
  })
})
