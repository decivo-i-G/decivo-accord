/**
 * Contrast in both schemes, computed from the generated tokens (`src/app/tokens.css`) and the dark
 * mapping in `src/app/globals.css`. Text needs 4.5:1 (WCAG AA), large text and the boundaries of
 * controls (input borders, focus ring, primary buttons) need 3:1. Hairlines (border.subtle/default/
 * strong) are decoration, not control boundaries, and are not part of this check.
 *
 * A second test reads every CSS module: each `color:` it sets must be one of the foregrounds below,
 * so a new text colour cannot slip past this check.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = fileURLToPath(new URL('..', import.meta.url))
const tokensCss = readFileSync(join(src, 'app/tokens.css'), 'utf8')
const globalsCss = readFileSync(join(src, 'app/globals.css'), 'utf8')

type Vars = Record<string, string>

/** `--name: value;` declarations inside a CSS block (comments removed). */
function declarations(block: string): Vars {
  const out: Vars = {}
  for (const m of block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g))
    out[m[1] as string] = (m[2] as string).trim()
  return out
}

/** The body of the first block whose selector is exactly `selector`. */
function block(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`${selector} not found`)
  const open = css.indexOf('{', at)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
  }
  throw new Error(`${selector} not closed`)
}

const light: Vars = declarations(block(tokensCss, ':root'))
const darkOverrides = declarations(block(globalsCss, ':root[data-theme="dark"]'))
const dark: Vars = { ...light, ...darkOverrides }
// "System" must map exactly the same names as "Dark", or one of them would leave something light.
const systemOverrides = declarations(block(globalsCss, '@media (prefers-color-scheme: dark)'))

type Rgba = [number, number, number, number]

function resolve(vars: Vars, name: string, seen: string[] = []): Rgba {
  const value = vars[name]
  if (!value) throw new Error(`${name} is not defined`)
  if (seen.includes(name)) throw new Error(`cycle at ${name}`)
  const ref = value.match(/^var\((--[a-z0-9-]+)\)$/)
  if (ref) return resolve(vars, ref[1] as string, [...seen, name])
  const hex = value.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i)
  if (!hex) throw new Error(`${name} is not a colour: ${value}`)
  const h = hex[1] as string
  const channel = (i: number) => Number.parseInt(h.slice(i, i + 2), 16)
  return [channel(0), channel(2), channel(4), hex[2] ? Number.parseInt(hex[2], 16) / 255 : 1]
}

/** A colour with alpha, painted over an opaque one. */
function over([r, g, b, a]: Rgba, [R, G, B]: Rgba): Rgba {
  return [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a), 1]
}

function luminance([r, g, b]: Rgba) {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function ratio(vars: Vars, fg: string, bg: string, page = '--color-surface-page') {
  const base = resolve(vars, page)
  const back = over(resolve(vars, bg), base)
  const front = over(resolve(vars, fg), back)
  const [a, b] = [luminance(front), luminance(back)].sort((x, y) => y - x) as [number, number]
  return (a + 0.05) / (b + 0.05)
}

const SURFACES = [
  '--color-surface-page',
  '--color-surface-card',
  '--color-surface-subtle',
  '--color-surface-hover',
  '--color-surface-sidebar',
  '--color-brand-50',
]
const TEXT = ['--color-ink', '--color-ink-body', '--color-ink-muted', '--color-brand-800']
const STATUS = ['success', 'warning', 'danger', 'info'] as const

/** [foreground, background, minimum] */
const PAIRS: [string, string, number][] = [
  ...TEXT.flatMap((fg) => SURFACES.map((bg): [string, string, number] => [fg, bg, 4.5])),
  ['--color-ink', '--color-selection', 4.5],
  ['--color-ink', '--color-brand-100', 4.5],
  ['--color-brand-800', '--color-brand-100', 4.5],
  ['--color-surface-card', '--color-ink', 4.5],
  ['--color-surface-card', '--color-ink-muted', 3],
  ['--color-on-brand', '--color-brand-700', 4.5],
  ['--color-on-brand', '--color-primary-hover', 4.5],
  ...STATUS.flatMap((s): [string, string, number][] => [
    [`--color-${s}-ink`, `--color-${s}-surface`, 4.5],
    [`--color-${s}-ink`, '--color-surface-card', 4.5],
    [`--color-${s}-ink`, '--color-surface-subtle', 4.5],
    ['--color-on-status', `--color-${s}-ink`, 4.5],
  ]),
  // Boundaries of controls and the focus ring: 3:1 against everything they sit on.
  ...['--color-border-control', '--color-focus', '--color-brand-700'].flatMap((fg) =>
    SURFACES.filter((bg) => bg !== '--color-brand-50' || fg === '--color-focus').map(
      (bg): [string, string, number] => [fg, bg, 3],
    ),
  ),
  // The switch: its off track (border and thumb) on the subtle fill, at full opacity, and the on thumb.
  ['--color-border-control', '--color-surface-subtle', 3],
  ['--color-ink-muted', '--color-surface-subtle', 3],
  ['--color-on-brand', '--color-brand-700', 3],
  // Swatch frames: a white swatch on white or a near-black one on dark keeps a visible edge.
  ...SURFACES.map((bg): [string, string, number] => ['--color-swatch-frame', bg, 3]),
  // The fourth logo dot is the only one that changes: it must stay visible on the page.
  ['--color-dot-4', '--color-surface-page', 3],
]

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('contrast (%s)', (_scheme, vars) => {
  it.each(PAIRS)('%s on %s ≥ %s', (fg, bg, min) => {
    expect(ratio(vars, fg, bg)).toBeGreaterThanOrEqual(min)
  })
})

describe('dark scheme', () => {
  it('maps every colour that has a dark token, and System maps the same as Dark', () => {
    const darkTokens = Object.keys(light).filter((n) => n.startsWith('--color-dark-'))
    for (const token of darkTokens) {
      const target = token.replace('--color-dark-', '--color-')
      expect(darkOverrides[target], `${target} has a dark token but is not mapped`).toBe(`var(${token})`)
    }
    expect(systemOverrides).toEqual(darkOverrides)
  })

  it('changes every text, surface and line colour', () => {
    for (const name of [...SURFACES, ...TEXT, '--color-border-subtle', '--color-border-default'])
      expect(resolve(dark, name), name).not.toEqual(resolve(light, name))
  })
})

describe('text colours in CSS modules', () => {
  const allowed = new Set([...TEXT, ...STATUS.map((s) => `--color-${s}-ink`)])
  allowed.add('--color-on-brand')
  allowed.add('--color-on-status')
  allowed.add('--color-surface-card')

  const dir = join(src, 'components')
  const files = readdirSync(dir).filter((f) => f.endsWith('.css'))

  // Rules that set both a background and a text colour: the pair itself must pass in both schemes.
  // A tinted background that is not one of the checked surfaces (a search highlight on brand-100)
  // must set its own text colour, or it inherits one (ink-muted) that was never checked against it.
  const rules = files.flatMap((file) =>
    [
      ...readFileSync(join(dir, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .matchAll(/([^{}]+)\{([^{}]*)\}/g),
    ].map((m) => ({
      where: `${file} ${(m[1] as string).trim()}`,
      bg: (m[2] as string).match(/(?:^|[;\s])background(?:-color)?:\s*var\((--color-[a-z0-9-]+)\)\s*;/)?.[1],
      fg: (m[2] as string).match(/(?:^|[;\s])color:\s*var\((--color-[a-z0-9-]+)\)/)?.[1],
    })),
  )

  it('own text colour on every tint that is not a checked surface', () => {
    const tints = new Set(['--color-brand-100', '--color-selection'])
    for (const r of rules.filter((r) => r.bg && tints.has(r.bg)))
      expect(r.fg, `${r.where} sets ${r.bg} without a text colour`).toBeDefined()
  })

  it.each([
    ['light', light],
    ['dark', dark],
  ] as const)('background and text set together pass 4.5:1 (%s)', (_scheme, vars) => {
    for (const r of rules) {
      if (!r.bg || !r.fg) continue
      expect(ratio(vars, r.fg, r.bg), `${r.where}: ${r.fg} on ${r.bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(files)('%s only uses checked text colours', (file) => {
    const css = readFileSync(join(dir, file), 'utf8')
    for (const m of css.matchAll(/(?:^|[;{\s])color:\s*var\((--color-[a-z0-9-]+)\)/g))
      expect(allowed.has(m[1] as string), `${file}: color ${m[1]}`).toBe(true)
  })
})
