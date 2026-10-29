import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildRegister,
  type ColorValue,
  colorToHex,
  cssToColor,
  parseLock,
  type RegisterFile,
  restrictTo,
  snapshotFromRegister,
  threeWayDiff,
} from '@decivo/accord-core'
import { describe, expect, it } from 'vitest'
import {
  DARK_SELECTORS,
  detectSelector,
  isDefaultThemeScope,
  normalizeSelector,
  parseCssVariables,
  resolveCssVariables,
  scopeMatches,
} from './css-vars.js'
import { scanCode } from './scan.js'
import { readStylesheets } from './stylesheets.js'

const fixtures = fileURLToPath(new URL('../test/fixtures/', import.meta.url))

describe('selectors of themes', () => {
  it('compares selectors however they are quoted or spaced', () => {
    expect(normalizeSelector(`[data-theme='dark']`)).toBe('[data-theme=dark]')
    expect(normalizeSelector('[data-theme = "dark"]')).toBe('[data-theme=dark]')
    expect(normalizeSelector('@media (prefers-color-scheme:  dark)')).toBe(
      '@media (prefers-color-scheme:dark)',
    )
    expect(scopeMatches('.dark, [data-theme="dark"]', '[data-theme=dark]')).toBe(true)
    expect(scopeMatches('.dark-blue', '.dark')).toBe(false)
  })

  it('reads a selector list with :root as the base scope', () => {
    const vars = parseCssVariables(
      `:root, [data-theme="light"] { --bg: #fff; } html.dark { --bg: #000; }`,
      'a.css',
    )
    expect(vars.map((v) => v.scope)).toEqual(['base', 'html.dark'])
  })

  it('lets a selector list with :root also apply in the context it names, in cascade order', () => {
    const vars = parseCssVariables(`.dark { --muted: #222; } :root, .dark { --muted: #eee; }`, 'a.css')
    expect(resolveCssVariables(vars).get('--muted')?.resolved).toBe('#eee')
    const dark = resolveCssVariables(vars, (s) => scopeMatches(s, '.dark'))
    expect(dark.get('--muted')?.resolved).toBe('#eee')
  })

  it('takes only root rules inside a single media query as that query’s scope', () => {
    const media = '@media (prefers-color-scheme: dark)'
    const vars = parseCssVariables(
      `${media} { :root { --a: 1; } :root:not(.light) { --b: 2; } .card { --c: 3; } }` +
        `${media} { @media (min-width: 600px) { :root { --d: 4; } } }` +
        `@media (min-width: 600px) { ${media} { :root { --e: 5; } } }`,
      'a.css',
    )
    const scope = (name: string) => vars.find((v) => v.name === name)?.scope ?? ''
    expect(scopeMatches(scope('--a'), media)).toBe(true)
    expect(scopeMatches(scope('--b'), media)).toBe(true)
    // A component inside the query and nested queries only apply sometimes: no context.
    for (const name of ['--c', '--d', '--e']) expect(scopeMatches(scope(name), media), name).toBe(false)
  })

  it('takes a light theme written only with [data-theme] as the base values', () => {
    const vars = parseCssVariables(
      `[data-theme='light'] { --bg: #fff; --fg: #111; } [data-theme='dark'] { --bg: #000; } :root { --fg: #222; }`,
      'a.css',
    )
    expect(isDefaultThemeScope(`[data-theme='light']`)).toBe(true)
    expect(isDefaultThemeScope(':root:not(.dark)')).toBe(true)
    expect(isDefaultThemeScope('.dark')).toBe(false)
    const base = resolveCssVariables(vars)
    // :root wins where it defines a variable; the light theme fills in the rest.
    expect([base.get('--bg')?.resolved, base.get('--fg')?.resolved]).toEqual(['#fff', '#222'])
    const dark = resolveCssVariables(vars, (s) => scopeMatches(s, '[data-theme="dark"]'))
    expect(dark.get('--bg')?.resolved).toBe('#000')
  })

  it('detects the dark selector in order of preference and reports it as written (F14)', () => {
    const css = (block: string) => parseCssVariables(`:root { --bg: #fff; } ${block}`, 'a.css')
    expect(detectSelector(css('.dark { --bg: #000 }'))).toBe('.dark')
    expect(detectSelector(css(`[data-theme=dark] { --bg: #000 }`))).toBe('[data-theme=dark]')
    expect(detectSelector(css(`:root[data-theme="dark"] { --bg: #000 }`))).toBe(':root[data-theme="dark"]')
    expect(detectSelector(css('html.dark { --bg: #000 }'))).toBe('html.dark')
    expect(detectSelector(css(`[data-mode="dark"] { --bg: #000 }`))).toBe('[data-mode="dark"]')
    expect(detectSelector(css('@media (prefers-color-scheme: dark) { :root { --bg: #000 } }'))).toBe(
      '@media (prefers-color-scheme: dark)',
    )
    // Both present: .dark is preferred.
    expect(
      detectSelector(
        css('@media (prefers-color-scheme: dark) { :root { --bg: #111 } } .dark { --bg: #000 }'),
      ),
    ).toBe('.dark')
    expect(detectSelector(css('.admin-theme { --bg: #eee }'))).toBeUndefined()
    expect(DARK_SELECTORS[0]).toBe('.dark')
  })
})

describe('stylesheets with @import', () => {
  it('follows relative and workspace imports, skips URLs and dependencies, and survives a cycle', async () => {
    const sheets = await readStylesheets(join(fixtures, 'themes'), ['src/styles/globals.css'])
    expect(sheets.files).toEqual([
      'src/styles/globals.css',
      'src/styles/theme/light.css',
      'src/styles/theme/dark.css',
      'packages/tokens/spacing.css',
    ])
    expect(sheets.skipped).toEqual([
      { from: 'src/styles/globals.css', import: 'tailwindcss', reason: 'missing' },
      {
        from: 'src/styles/globals.css',
        import: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap',
        reason: 'remote',
      },
      { from: 'src/styles/theme/dark.css', import: 'src/styles/globals.css', reason: 'cycle' },
    ])
    const base = resolveCssVariables(sheets.variables)
    expect(base.get('--color-surface')?.resolved).toBe('#ffffff')
    expect(base.get('--space-4')?.resolved).toBe('1rem')
    expect(detectSelector(sheets.variables)).toBe(`[data-theme='dark']`)
  })

  it('puts the variables of a media-conditioned import under that condition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'accord-import-'))
    try {
      await writeFile(
        join(root, 'app.css'),
        `@import "dark.css" (prefers-color-scheme: dark);\n:root { --bg: #fff; }`,
      )
      await writeFile(join(root, 'dark.css'), ':root { --bg: #000; }')
      const sheets = await readStylesheets(root, ['app.css'])
      expect(sheets.variables.map((v) => [v.name, v.scope])).toEqual([
        ['--bg', '@media (prefers-color-scheme: dark)'],
        ['--bg', 'base'],
      ])
      expect(detectSelector(sheets.variables)).toBe('@media (prefers-color-scheme: dark)')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('follows a workspace package linked into node_modules, never an installed dependency', async () => {
    const root = await mkdtemp(join(tmpdir(), 'accord-pkg-'))
    try {
      const write = async (path: string, content: string) => {
        await mkdir(dirname(join(root, path)), { recursive: true })
        await writeFile(join(root, path), content)
      }
      await write('app.css', '@import "@acme/ui";\n@import "tailwindcss";')
      await write('libs/ui/package.json', JSON.stringify({ name: 'not-the-import-name', style: 'theme.css' }))
      await write('libs/ui/theme.css', ':root { --brand: #3c6681; }')
      await write(
        'node_modules/.pnpm/tailwindcss@4/node_modules/tailwindcss/index.css',
        '@theme { --color-red-500: red; }',
      )
      await mkdir(join(root, 'node_modules/@acme'), { recursive: true })
      await symlink(join(root, 'libs/ui'), join(root, 'node_modules/@acme/ui'))
      await symlink(
        join(root, 'node_modules/.pnpm/tailwindcss@4/node_modules/tailwindcss'),
        join(root, 'node_modules/tailwindcss'),
      )
      const sheets = await readStylesheets(root, ['app.css'])
      expect(sheets.files).toEqual(['app.css', 'libs/ui/theme.css'])
      expect(sheets.skipped).toEqual([{ from: 'app.css', import: 'tailwindcss', reason: 'package' }])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

// --- the code surface per context ---

const color = (hex: string) => ({ $value: cssToColor(hex) })
const registerFiles = (darkSelector?: string): RegisterFile[] => [
  {
    path: 'accord.config.yaml',
    content: `version: 1\nsurfaces:\n  code:\n    css: [src/app/globals.css]\n${darkSelector ? `    modes: { dark: '${darkSelector}' }\n` : ''}`,
  },
  {
    path: 'tokens/color.tokens.json',
    content: JSON.stringify({
      color: {
        $type: 'color',
        background: {
          ...color('#ffffff'),
          $extensions: { 'de.decivo.accord': { ids: { css: '--background' } } },
        },
        foreground: {
          ...color('oklch(0.145 0 0)'),
          $extensions: { 'de.decivo.accord': { ids: { css: '--foreground' } } },
        },
        primary: {
          ...color('oklch(0.205 0 0)'),
          $extensions: { 'de.decivo.accord': { ids: { css: '--color-primary' } } },
        },
        border: {
          ...color('oklch(0.922 0 0)'),
          $extensions: { 'de.decivo.accord': { ids: { css: '--border' } } },
        },
      },
    }),
  },
  {
    path: 'modes/theme/dark.tokens.json',
    content: JSON.stringify({
      color: {
        background: color('oklch(0.145 0 0)'),
        foreground: color('oklch(0.985 0 0)'),
        // Code says oklch(0.922 0 0): drift in dark only.
        primary: color('oklch(0.9 0 0)'),
      },
    }),
  },
  {
    path: 'resolver.json',
    content: JSON.stringify({
      version: '2025.10',
      sets: { core: { sources: [{ $ref: 'tokens/color.tokens.json' }] } },
      modifiers: {
        theme: {
          contexts: { light: [], dark: [{ $ref: 'modes/theme/dark.tokens.json' }] },
          default: 'light',
        },
      },
      resolutionOrder: [{ $ref: '#/sets/core' }, { $ref: '#/modifiers/theme' }],
    }),
  },
]

describe('code surface per context', () => {
  const root = join(fixtures, 'shadcn')

  it('reads the dark values of a shadcn globals.css under .dark and finds the drift there only', async () => {
    const register = buildRegister(registerFiles())
    expect(register.issues).toEqual([])
    const scan = await scanCode({ root, register })
    expect(scan.modes).toEqual([{ context: 'dark', selector: '.dark', how: 'detected', found: true }])
    expect(scan.snapshot.coverage.contexts).toEqual(['theme=dark'])
    const items = threeWayDiff({
      base: undefined,
      register: restrictTo(snapshotFromRegister(register), scan.snapshot.coverage),
      surface: scan.snapshot,
    })
    expect(
      items.map((i) => [
        i.op.path,
        i.op.kind === 'token.value_changed' ? i.op.context : undefined,
        i.op.kind === 'token.value_changed' ? colorToHex(i.op.after as ColorValue) : undefined,
        i.classification.deletion,
      ]),
    ).toEqual([
      [
        'tokens.color.primary',
        { theme: 'dark' },
        colorToHex(cssToColor('oklch(0.922 0 0)') as ColorValue),
        false,
      ],
      // .dark sets --border, the register has no dark border: dark gets its own value.
      [
        'tokens.color.border',
        { theme: 'dark' },
        colorToHex(cssToColor('oklch(1 0 0 / 10%)') as ColorValue),
        false,
      ],
    ])
    expect(parseLock(undefined).surfaces.code).toBeUndefined()
  })

  it('uses a configured selector, and compares nothing in dark when code has no such block', async () => {
    const configured = await scanCode({ root, register: buildRegister(registerFiles('[data-theme="dark"]')) })
    expect(configured.modes).toEqual([
      { context: 'dark', selector: '[data-theme="dark"]', how: 'configured', found: false },
    ])
    expect(configured.snapshot.coverage.contexts).toBeUndefined()
  })

  it('keeps a register without modes exactly as before', async () => {
    const files = registerFiles().filter((f) => f.path !== 'resolver.json' && !f.path.startsWith('modes/'))
    const scan = await scanCode({ root, register: buildRegister(files) })
    expect(scan.modes).toEqual([])
    expect(scan.snapshot.contexts).toBeUndefined()
  })
})
