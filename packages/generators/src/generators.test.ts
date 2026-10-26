import { buildRegister, cssToColor, type RegisterFile } from '@decivo/accord-core'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { BLOCK_BEGIN, BLOCK_END, generateAgentsMd, upsertManagedBlock } from './agents-md.js'
import { generateCss, generateTailwindTheme } from './css.js'
import { DESIGN_MD_MARKER, designMdName, generateDesignMd } from './design-md.js'
import { planExport } from './export.js'
import { fingerprint } from './values.js'

const files: RegisterFile[] = [
  {
    path: 'accord.config.yaml',
    content:
      'version: 1\nname: decivo\noutputs:\n  claude_md: CLAUDE.md\nsurfaces:\n  code:\n    outputs:\n      - { format: css, path: src/tokens.css }\n      - { format: tailwind, path: src/theme.css }\n',
  },
  {
    path: 'tokens/color.tokens.json',
    content: JSON.stringify({
      color: {
        $type: 'color',
        brand: {
          '600': { $value: cssToColor('#487a98'), $description: 'Markenfarbe' },
          '700': { $value: cssToColor('#3c6681') },
        },
        primary: { $value: '{color.brand.700}' },
        scrim: { $value: cssToColor('rgba(22,27,31,0.32)') },
      },
    }),
  },
  {
    path: 'tokens/rest.tokens.json',
    content: JSON.stringify({
      radius: { $type: 'dimension', md: { $value: { value: 8, unit: 'px' } } },
      spacing: { $type: 'dimension', lg: { $value: { value: 1.5, unit: 'rem' } } },
      shadow: {
        card: {
          $type: 'shadow',
          $value: {
            color: cssToColor('rgba(0,0,0,0.04)'),
            offsetX: { value: 0, unit: 'px' },
            offsetY: { value: 1, unit: 'px' },
            blur: { value: 3, unit: 'px' },
            spread: { value: 0, unit: 'px' },
          },
        },
      },
      typography: {
        h1: {
          $type: 'typography',
          $value: {
            fontFamily: 'Merriweather',
            fontSize: { value: 3.5, unit: 'rem' },
            fontWeight: 700,
            letterSpacing: { value: 0, unit: 'px' },
            lineHeight: 1.1,
          },
          $extensions: { 'de.decivo.accord': { css: { fontSize: 'clamp(2.5rem, 5vw, 3.5rem)' } } },
        },
      },
      font: { heading: { $type: 'fontFamily', $value: ['Merriweather', 'Georgia', 'serif'] } },
    }),
  },
  {
    path: 'components/button.yaml',
    content:
      'name: Button\nvariants: { variant: [primary, ghost] }\nmappings:\n  code: { path: src/components/ui/button.tsx, export: Button }\n',
  },
  {
    path: 'decisions/D-004.yaml',
    content:
      'id: D-004\nrule: Markenfarben nur aus der brand-Skala\nwhy: Ein konsistentes Blau macht decivo wiedererkennbar.\nscope: [tokens.color.brand.**]\nlevel: must\nowner: design\nfix_hint: Nächsten Token der Skala nehmen.\n',
  },
]
const register = buildRegister(files)
const fp = fingerprint(files)

describe('register used by these tests', () => {
  it('is valid', () => expect(register.issues).toEqual([]))
})

describe('DESIGN.md', () => {
  const md = generateDesignMd(register, { name: 'decivo', fingerprint: fp })
  const [, yaml, body] = md.split(/^---$/m)
  const front = parse(yaml as string)

  it('puts tokens in YAML front matter per the DESIGN.md format', () => {
    expect(front).toMatchObject({
      version: 'alpha',
      name: 'decivo',
      colors: {
        'brand-600': '#487a98',
        'brand-700': '#3c6681',
        primary: '{colors.brand-700}',
        scrim: '#161b1f52',
      },
      typography: {
        h1: { fontFamily: 'Merriweather', fontSize: '3.5rem', fontWeight: 700, lineHeight: 1.1 },
      },
      rounded: { md: '8px' },
      spacing: { lg: '1.5rem' },
    })
    expect(front.typography.h1.letterSpacing).toBeUndefined()
  })

  it('writes sections in the specified order and keeps decisions with their reason', () => {
    const headings = (body as string).match(/^## .+$/gm)
    expect(headings).toEqual([
      '## Overview',
      '## Colors',
      '## Typography',
      '## Layout',
      '## Elevation & Depth',
      '## Shapes',
      '## Components',
      "## Do's and Don'ts",
    ])
    expect(body).toContain(
      '- **Must**: Markenfarben nur aus der brand-Skala – Ein konsistentes Blau macht decivo wiedererkennbar. (D-004)',
    )
    expect(body).toContain('Font size in CSS: `clamp(2.5rem, 5vw, 3.5rem)`')
    expect(body).toContain(`${DESIGN_MD_MARKER} accord:${fp} -->`)
  })

  it('names tokens without their section prefix', () => {
    expect(designMdName('color.brand.600')).toBe('brand-600')
    expect(designMdName('color.brand.$root')).toBe('brand')
    expect(designMdName('admin.brand-700')).toBe('admin-brand-700')
  })
})

describe('AGENTS.md', () => {
  const md = generateAgentsMd(register, { fingerprint: fp })
  it('states the rules, the decisions with why and the token table', () => {
    expect(md).toContain('call `check_change` on the `accord` MCP server')
    expect(md).toContain('- **D-004** (must, owner design): Markenfarben nur aus der brand-Skala')
    expect(md).toContain('  - Why: Ein konsistentes Blau macht decivo wiedererkennbar.')
    expect(md).toContain('| `color.brand.600` | `--color-brand-600` | #487a98 |')
    expect(md).toContain('| `color.primary` | `--color-primary` | → color.brand.700 |')
    expect(md).toContain('- **Button** – `src/components/ui/button.tsx`; variants variant=primary|ghost')
  })
})

describe('managed blocks', () => {
  it('appends, replaces and leaves the rest alone', () => {
    const first = upsertManagedBlock('# Team notes\n\nKeep this.\n', 'v1')
    expect(first).toBe(`# Team notes\n\nKeep this.\n\n${BLOCK_BEGIN}\nv1\n${BLOCK_END}\n`)
    const second = upsertManagedBlock(`${first}\nAfter.\n`, 'v2')
    expect(second).toBe(`# Team notes\n\nKeep this.\n\n${BLOCK_BEGIN}\nv2\n${BLOCK_END}\n\nAfter.\n`)
    expect(upsertManagedBlock(undefined, 'x')).toBe(`${BLOCK_BEGIN}\nx\n${BLOCK_END}\n`)
  })
})

describe('CSS and Tailwind', () => {
  it('writes custom properties with references, alpha, shadows and exact CSS overrides', () => {
    const css = generateCss(register, fp)
    expect(css).toContain('  --color-brand-600: #487a98; /* Markenfarbe */')
    expect(css).toContain('  --color-primary: var(--color-brand-700);')
    expect(css).toContain('  --color-scrim: #161b1f52;')
    expect(css).toContain('  --shadow-card: 0 1px 3px 0 #0000000a;')
    expect(css).toContain('  --font-heading: Merriweather, Georgia, serif;')
    expect(css).not.toContain('typography')
  })

  it('maps tokens into the Tailwind v4 theme only where the name differs', () => {
    const theme = generateTailwindTheme(register, fp)
    expect(theme).toContain('@theme inline {')
    expect(theme).not.toContain('--color-brand-600: var(--color-brand-600)')
  })
})

describe('planExport', () => {
  const disk = (entries: Record<string, string>) => async (path: string) => entries[path]

  it('generates into .accord/generated and the configured files', async () => {
    const plans = await planExport({ register, files, registerDir: '.accord', read: disk({}) })
    expect(plans.map((p) => [p.path, p.mode, p.changed])).toEqual([
      ['.accord/generated/DESIGN.md', 'generated', true],
      ['.accord/generated/AGENTS.md', 'generated', true],
      ['DESIGN.md', 'generated', true],
      ['AGENTS.md', 'block', true],
      ['CLAUDE.md', 'block', true],
      ['src/tokens.css', 'generated', true],
      ['src/theme.css', 'generated', true],
    ])
  })

  it('never overwrites a hand-written DESIGN.md and reports nothing changed when up to date', async () => {
    const first = await planExport({
      register,
      files,
      registerDir: '.accord',
      read: disk({ 'DESIGN.md': '# Ours\n' }),
    })
    expect(first.find((p) => p.path === 'DESIGN.md')).toMatchObject({ mode: 'skipped', changed: false })
    const written = Object.fromEntries(
      first.filter((p) => p.mode !== 'skipped').map((p) => [p.path, p.content]),
    )
    const second = await planExport({
      register,
      files,
      registerDir: '.accord',
      read: disk({ ...written, 'DESIGN.md': '# Ours\n' }),
    })
    expect(second.some((p) => p.changed)).toBe(false)
  })

  it('fingerprints the authored register, ignoring generated output and the lock', () => {
    expect(
      fingerprint([
        ...files,
        { path: 'generated/DESIGN.md', content: 'x' },
        { path: 'surfaces.lock.json', content: '{}' },
      ]),
    ).toBe(fp)
    expect(fingerprint([...files.slice(1)])).not.toBe(fp)
  })
})
