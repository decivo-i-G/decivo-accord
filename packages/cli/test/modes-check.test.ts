import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkChange, formatCheck } from '../src/check.js'
import { driftReport, initCommand } from '../src/commands.js'
import { formatDriftReport } from '../src/format.js'
import { translator } from '../src/messages.js'

const fixture = fileURLToPath(new URL('./fixtures/shadcn', import.meta.url))

// Text on surface 4.5:1 and card text on cards, as the decivo style asks for, in light and dark.
const D003 = `id: D-003
rule: Text reaches 4.5:1 on its surface
why: Readable for everyone, in light and in dark.
scope: [tokens.color.foreground, tokens.color.background, tokens.color.card, tokens.color.card-foreground]
level: must
owner: design
checks:
  - type: deterministic
    rule: { kind: min_contrast, ratio: 4.5, foreground: tokens.color.foreground, background: tokens.color.background }
  - type: deterministic
    rule: { kind: min_contrast, ratio: 4.5, foreground: tokens.color.card-foreground, background: tokens.color.card }
`

describe('checks in light and dark', () => {
  let root = ''
  let css = ''
  const darkFile = () => join(root, '.accord/modes/theme/dark.tokens.json')

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'accord-modes-check-'))
    await cp(fixture, root, { recursive: true })
    await initCommand({ root, register: '.accord', force: false, dryRun: false }, translator('en'), () => {})
    await writeFile(join(root, '.accord/decisions/D-003.yaml'), D003)
    css = await readFile(join(root, 'src/app/globals.css'), 'utf8')
  })
  afterAll(() => rm(root, { recursive: true, force: true }))

  it('passes a register whose contrast holds in light and dark', async () => {
    const result = await checkChange({
      root,
      registerDir: '.accord',
      paths: ['.accord/modes/theme/dark.tokens.json'],
    })
    expect(result.findings).toEqual([])
    expect(result.ok).toBe(true)
    expect((await driftReport({ root, register: '.accord' })).modes).toEqual({
      default: 'light',
      contexts: ['light', 'dark'],
      fallbacks: [{ context: 'dark', tokens: [] }],
      contrast: [],
    })
  })

  it('fails a .dark edit in code that breaks contrast in dark, naming the context', async () => {
    await writeFile(
      join(root, 'src/app/globals.css'),
      css.replace(
        '.dark {\n  --background: oklch(0.145 0 0);\n  --foreground: oklch(0.985 0 0);',
        '.dark {\n  --background: oklch(0.145 0 0);\n  --foreground: oklch(0.3 0 0);',
      ),
    )
    try {
      const result = await checkChange({ root, registerDir: '.accord', paths: ['src/app/globals.css'] })
      expect(result.ok).toBe(false)
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            decision: 'D-003',
            at: 'tokens.color.foreground',
            context: 'dark',
            level: 'must',
          }),
        ]),
      )
      expect(formatCheck(result)).toMatch(
        /tokens\.color\.foreground \(dark\)\s+\d+(\.\d+)?:1 on color\.background, needs 4\.5:1/,
      )
    } finally {
      await writeFile(join(root, 'src/app/globals.css'), css)
    }
  })

  it('catches a dark card that falls back to the light card: contrast in dark fails, F15 notes it', async () => {
    const original = await readFile(darkFile(), 'utf8')
    const dark = JSON.parse(original)
    delete dark.color.card
    await writeFile(darkFile(), JSON.stringify(dark, null, 2))
    try {
      const result = await checkChange({
        root,
        registerDir: '.accord',
        paths: ['.accord/modes/theme/dark.tokens.json'],
      })
      expect(result.ok).toBe(false)
      expect(result.findings).toEqual([
        expect.objectContaining({ decision: 'D-003', at: 'tokens.color.card-foreground', context: 'dark' }),
      ])
      expect(result.warnings).toEqual([{ code: 'context_fallback', token: 'color.card', context: 'dark' }])
      expect(formatCheck(result)).toContain(
        'Note: color.card has no dark value of its own and shows its default value in dark.',
      )

      const report = await driftReport({ root, register: '.accord' })
      expect(report.modes?.fallbacks).toEqual([{ context: 'dark', tokens: ['color.card'] }])
      expect(report.modes?.contrast).toEqual([
        expect.objectContaining({
          decision: 'D-003',
          at: 'tokens.color.card-foreground',
          context: 'dark',
          required: 4.5,
        }),
      ])
      const text = formatDriftReport(report, translator('en'))
      expect(text).toContain('Modes (light, dark)')
      expect(text).toContain(
        'Note: 1 colour(s) without a dark value of their own show the light value there: color.card',
      )
    } finally {
      await writeFile(darkFile(), original)
    }
  })
})
