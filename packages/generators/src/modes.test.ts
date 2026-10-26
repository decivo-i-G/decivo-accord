import { buildRegister, cssToColor, type RegisterFile } from '@decivo/accord-core'
import { describe, expect, it } from 'vitest'
import { generateAgentsMd, generateClaudeMdBlock } from './agents-md.js'
import { generateCss, generateTailwindTheme } from './css.js'
import { generateDesignMd } from './design-md.js'
import { planExport } from './export.js'

const color = (hex: string) => ({ $value: cssToColor(hex) })
const files = (modes = ''): RegisterFile[] => [
  {
    path: 'accord.config.yaml',
    content: `version: 1\nname: Shop\noutputs:\n  claude_md: CLAUDE.md\nsurfaces:\n  code:\n${modes}    outputs:\n      - { format: css, path: src/tokens.css }\n`,
  },
  {
    path: 'tokens/color.tokens.json',
    content: JSON.stringify({
      color: {
        $type: 'color',
        neutral: { '50': color('#fafafa'), '950': color('#0a0a0a') },
        background: {
          $value: '{color.neutral.50}',
          $extensions: { 'de.decivo.accord': { ids: { css: '--background' } } },
        },
        foreground: {
          ...color('#0a0a0a'),
          $extensions: { 'de.decivo.accord': { ids: { css: '--foreground' } } },
        },
        text: { $value: '{color.foreground}' },
        brand: color('#3c6681'),
      },
      radius: { $type: 'dimension', md: { $value: { value: 8, unit: 'px' } } },
    }),
  },
  {
    path: 'modes/theme/dark.tokens.json',
    content: JSON.stringify({
      color: { background: { $value: '{color.neutral.950}' }, foreground: color('#fafafa') },
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

describe('generated files per context', () => {
  const register = buildRegister(files())

  it('writes :root and a .dark block with the values that differ there', () => {
    expect(register.issues).toEqual([])
    const css = generateCss(register, 'fp')
    expect(css).toContain(':root {\n  --color-neutral-50: #fafafa;')
    const dark = css.slice(css.indexOf('.dark {'))
    expect(dark).toBe(
      [
        '.dark {',
        '  --background: var(--color-neutral-950);',
        '  --foreground: #fafafa;',
        // An alias that follows a dark value is declared again, so it also switches below a .dark element.
        '  --color-text: var(--foreground);',
        '}',
        '',
      ].join('\n'),
    )
    expect(css).not.toContain('--color-brand: #3c6681;\n}\n/* Context')
    // Tailwind keeps pointing at the variables; nothing per context there.
    expect(generateTailwindTheme(register, 'fp')).not.toContain('dark')
  })

  it('uses the configured selector, also a media condition', () => {
    const media = buildRegister(files(`    modes: { dark: '@media (prefers-color-scheme: dark)' }\n`))
    expect(generateCss(media, 'fp')).toContain(
      '@media (prefers-color-scheme: dark) {\n  :root {\n    --background: var(--color-neutral-950);',
    )
    const attr = buildRegister(files(`    modes: { dark: '[data-theme="dark"]' }\n`))
    expect(generateCss(attr, 'fp')).toContain('[data-theme="dark"] {\n  --background:')
  })

  it('lists the dark values in DESIGN.md next to the default', () => {
    const md = generateDesignMd(register, { name: 'Shop', fingerprint: 'fp' })
    expect(md).toContain('light is the default, dark under `.dark`')
    expect(md).toContain('- **background** (`#fafafa`; dark: `#0a0a0a`)')
    expect(md).toContain('- **brand** (`#3c6681`)')
  })

  it('adds a column per context to the token table in AGENTS.md and names them in CLAUDE.md', () => {
    const agents = generateAgentsMd(register, { fingerprint: 'fp' })
    expect(agents).toContain('`light` is the default (`:root`); `dark` applies under `.dark`.')
    expect(agents).toContain('| Token | CSS variable | Value | dark |\n| --- | --- | --- | --- |')
    expect(agents).toContain(
      '| `color.background` | `--background` | → color.neutral.50 | → color.neutral.950 |',
    )
    expect(agents).toContain('| `color.text` | `--color-text` | → color.foreground | |')
    expect(agents).toContain('| `color.brand` | `--color-brand` | #3c6681 | |')
    const claude = generateClaudeMdBlock({ fingerprint: 'fp', agentsPath: 'AGENTS.md', register })
    expect(claude).toContain('light (default, `:root`), dark (`.dark`, 3 value(s) differ)')
  })

  it('leaves the output of a register without modes as it was', async () => {
    const plain = buildRegister(
      files().filter((f) => f.path !== 'resolver.json' && !f.path.startsWith('modes/')),
    )
    expect(generateCss(plain, 'fp')).not.toContain('Context')
    expect(generateAgentsMd(plain, { fingerprint: 'fp' })).toContain(
      '| Token | CSS variable | Value |\n| --- | --- | --- |\n',
    )
    expect(
      generateClaudeMdBlock({ fingerprint: 'fp', agentsPath: 'AGENTS.md', register: plain }),
    ).not.toContain('context')
    // The export notices a change of a dark value (the fingerprint covers modes/ and resolver.json).
    const read = async () => undefined
    const before = await planExport({ register, files: files(), registerDir: '.accord', read })
    const changed = files().map((f) =>
      f.path === 'modes/theme/dark.tokens.json'
        ? { ...f, content: JSON.stringify({ color: { foreground: color('#eeeeee') } }) }
        : f,
    )
    const after = await planExport({
      register: buildRegister(changed),
      files: changed,
      registerDir: '.accord',
      read,
    })
    const css = (plans: typeof before) => plans.find((p) => p.path === 'src/tokens.css')?.content
    expect(css(after)).not.toBe(css(before))
    expect(css(after)).toContain('--foreground: #eeeeee;')
  })
})
