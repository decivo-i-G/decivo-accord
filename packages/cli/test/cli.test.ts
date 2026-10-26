import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { diffCommand, driftReport, explainOwnerCommand, exportCommand, initCommand } from '../src/commands.js'
import { formatDriftReport } from '../src/format.js'
import { planInit } from '../src/init.js'
import { translator } from '../src/messages.js'

const fixture = fileURLToPath(new URL('./fixtures/shop', import.meta.url))
const t = translator('de')

describe('accord init', () => {
  it('detects sources and plans a valid register', async () => {
    const plan = await planInit(fixture, t)
    expect(plan.detected).toEqual({
      designMd: ['design/DESIGN.md'],
      tokens: [{ path: 'design/tokens.json', format: 'tokens-studio' }],
      css: ['src/app/globals.css'],
      uiDir: 'src/components/ui',
      storybook: false,
      pen: [],
      figma: [],
    })
    expect(plan.register.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect([...plan.files.keys()]).toEqual([
      'accord.config.yaml',
      'tokens/color.tokens.json',
      'tokens/radius.tokens.json',
      'components/button.yaml',
      'components/dialog.yaml',
      'decisions/D-001.yaml',
      'decisions/D-002.yaml',
    ])
  })

  it('maps tokens to existing CSS variables by value and name', async () => {
    const plan = await planInit(fixture, t)
    // Numeric keys come first in JSON objects, hence 700 before $root.
    expect(plan.mappedVariables).toEqual([
      { token: 'color.brand.700', variable: '--brand-700' },
      { token: 'color.brand.$root', variable: '--brand-blue' },
      { token: 'color.text', variable: '--ink' },
      { token: 'radius.md', variable: '--radius' },
    ])
  })

  it('names the start source and lists what code corrected', async () => {
    const plan = await planInit(fixture, t)
    expect(plan.source).toEqual({ kind: 'code', reason: 'code-has-variables' })
    expect(plan.openPoints).toEqual({
      corrected: [{ path: 'color.border.$root', tokens: '#000000', code: '#000000 / 10%' }],
      dropped: [],
      skipped: [],
      codeOnly: 0,
    })
    const tokensWin = await planInit(fixture, t, { from: 'tokens' })
    expect(tokensWin.openPoints.corrected).toEqual([])
  })

  it('builds tokens from CSS variables when there is no token file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'accord-'))
    try {
      await cp(join(fixture, 'src'), join(dir, 'src'), { recursive: true })
      await cp(join(fixture, 'components.json'), join(dir, 'components.json'))
      await cp(join(fixture, 'tsconfig.json'), join(dir, 'tsconfig.json'))
      const plan = await planInit(dir, t)
      expect([...plan.register.tokens.keys()]).toEqual([
        'color.brand-blue',
        'color.brand-700',
        'color.ink',
        'color.border',
        'dimension.radius',
      ])
      expect(plan.register.issues.filter((i) => i.severity === 'error')).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('explains --from design without Figma exports or .pen files', async () => {
    await expect(planInit(fixture, t, { from: 'design' })).rejects.toMatchObject({ key: 'init.designNone' })
  })

  it('reads component contracts from the shadcn kit', async () => {
    const plan = await planInit(fixture, t)
    expect(plan.files.get('components/button.yaml')).toContain('variant:\n    - default\n    - ghost')
    expect(plan.files.get('components/dialog.yaml')).toContain('anatomy:\n  - root\n  - trigger\n  - content')
    expect(plan.register.components.get('Button')?.status).toBe('draft')
    // shadcn preset fills what code does not show; variants and anatomy stay as in code.
    expect(plan.register.components.get('Button')).toMatchObject({
      variants: { variant: ['default', 'ghost'], size: ['default', 'sm'] },
      props: { type: { type: 'enum', default: 'button' }, disabled: { type: 'boolean' } },
      states: ['default', 'hover', 'focus-visible', 'active', 'disabled'],
      a11y: { role: 'button', min_target: 24 },
    })
    expect(plan.register.components.get('Dialog')).toMatchObject({
      anatomy: ['root', 'trigger', 'content'],
      slots: { title: 'required' },
      a11y: { role: 'dialog' },
    })
  })
})

describe('accord diff on a freshly initialised register', () => {
  let dir: string
  const out: string[] = []
  const print = (text: string) => out.push(text)

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'accord-'))
    await cp(fixture, dir, { recursive: true })
    expect(await initCommand({ root: dir, register: '.accord', force: false, dryRun: false }, t, print)).toBe(
      0,
    )
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('refuses to overwrite without --force', async () => {
    expect(await initCommand({ root: dir, register: '.accord', force: false, dryRun: false }, t, print)).toBe(
      1,
    )
  })

  it('lets code win by default: the border value comes from globals.css, so nothing drifts', async () => {
    const report = await driftReport({ root: dir, register: '.accord' })
    expect(report.code.drift).toEqual([])
  })

  it('reports drift, hard values with replacements and near misses', async () => {
    expect(
      await initCommand(
        { root: dir, register: '.accord-tokens', force: false, dryRun: false, from: 'tokens' },
        t,
        print,
      ),
    ).toBe(0)
    const report = await driftReport({ root: dir, register: '.accord-tokens' })
    expect(report.code.drift).toEqual([
      {
        path: 'tokens.color.border.$root',
        kind: 'token.value_changed',
        origin: 'unknown',
        owner: 'design',
        breaking: false,
        reason: 'value changed; usages keep working but look different',
        register: '#000000',
        surface: '#000000 / 10%',
      },
    ])
    expect(report.code.hardValues.map((h) => [h.raw, h.replacement ?? h.near?.path ?? null])).toEqual([
      ['#487a98', 'color.brand.$root'],
      ['13px', null],
      ['#4a7d9b', 'color.brand.$root'],
    ])
    // bg-primary in cva and twice in JSX, var(--brand-blue) in Hero; alias definitions in globals.css do not count.
    expect(report.code.adoption).toEqual({ tokenUses: 4, hardColours: 2, rate: 0.67 })
    const text = formatDriftReport(report, t)
    expect(text).toContain('tokens.color.border.$root')
    expect(text).toContain('Ersatz: color.brand.$root')
  })

  it('prints JSON and explains owners', async () => {
    out.length = 0
    await diffCommand({ root: dir, register: '.accord', json: true, limit: 10 }, t, print)
    expect(JSON.parse(out.join('\n')).register.tokens).toBe(5)
    out.length = 0
    await explainOwnerCommand({ root: dir, register: '.accord', path: 'tokens.color.brand.700' }, print)
    expect(out[0]).toContain('→ design')
  })

  it('writes a config that loads cleanly', async () => {
    const config = await readFile(join(dir, '.accord/accord.config.yaml'), 'utf8')
    expect(config).toContain('css: ["src/app/globals.css"]')
  })
})

describe('accord export', () => {
  let dir: string
  const out: string[] = []
  const print = (text: string) => out.push(text)

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'accord-export-'))
    await cp(fixture, dir, { recursive: true })
    await initCommand({ root: dir, register: '.accord', force: false, dryRun: false }, t, print)
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('fails --check before the first export, writes files, then passes --check', async () => {
    expect(await exportCommand({ root: dir, register: '.accord', check: true }, t, print)).toBe(1)
    expect(await exportCommand({ root: dir, register: '.accord', check: false }, t, print)).toBe(0)
    expect(await exportCommand({ root: dir, register: '.accord', check: true }, t, print)).toBe(0)
    const design = await readFile(join(dir, '.accord/generated/DESIGN.md'), 'utf8')
    expect(design.startsWith('---\nversion: alpha')).toBe(true)
    const agents = await readFile(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('<!-- accord:begin -->')
  })

  it('leaves the hand-written design/DESIGN.md alone (it is not at the configured path)', async () => {
    expect(await readFile(join(dir, 'design/DESIGN.md'), 'utf8')).toBe('# Shop design system\n')
  })
})

describe('accord init with several token sets', () => {
  it('takes the default set, the dark set as the dark context, and keeps same-named files apart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'accord-sets-'))
    const color = (hex: string) => ({ $type: 'color', $value: hex })
    const write = async (path: string, json: unknown) => {
      await mkdir(join(root, dirname(path)), { recursive: true })
      await writeFile(join(root, path), JSON.stringify(json))
    }
    await write('tokens/Dark.tokens.json', { bg: { primary: color('#000000') } })
    await write('tokens/Light.tokens.json', { bg: { primary: color('#ffffff') } })
    await write('figma/origin/Value.tokens.json', { space: { sm: { $type: 'number', $value: 4 } } })
    await write('figma/baseline/Value.tokens.json', { radius: { sm: { $type: 'number', $value: 2 } } })
    await write('tokens/broken.tokens.json', { oops: { $value: 'x', $type: 'unknown-type' } })
    const plan = await planInit(root, t)
    expect(plan.register.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect([...plan.files.keys()].filter((f) => f.startsWith('tokens/')).sort()).toEqual([
      'tokens/Light.tokens.json',
      'tokens/Value.tokens.json',
      'tokens/origin-Value.tokens.json',
    ])
    // Dark.tokens.json is no longer an open point: it became the context "dark" (modes/theme/dark.tokens.json).
    expect(plan.openPoints.skipped).toEqual([
      expect.objectContaining({ file: 'tokens/broken.tokens.json', reason: 'invalidTokens' }),
    ])
    expect(plan.modes).toMatchObject({
      source: 'tokens',
      from: ['tokens/Dark.tokens.json'],
      values: { dark: 1 },
    })
    await rm(root, { recursive: true, force: true })
  })
})
