import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseLock } from '@decivo/accord-core'
import { loadValidRegister } from '@decivo/accord-core/node'
import { afterEach, describe, expect, it } from 'vitest'
import { canvas, FIG_SCHEMA, zip } from '../../adapters/figma/test/kiwi.js'
import { figmaCommand, initCommand, penCommand } from '../src/commands.js'
import { AccordError } from '../src/errors.js'
import { translator } from '../src/messages.js'

const t = translator('en')

// A Figma REST response (variables/local): primitives, a themed collection, a scoped number, a text variable.
const REST = {
  meta: {
    variableCollections: {
      p: { id: 'p', name: 'Primitives', defaultModeId: 'v', modes: [{ modeId: 'v', name: 'Value' }] },
      s: {
        id: 's',
        name: 'Semantic',
        defaultModeId: 'l',
        modes: [
          { modeId: 'l', name: 'Light' },
          { modeId: 'd', name: 'Dark' },
        ],
      },
    },
    variables: {
      b: {
        id: 'b',
        name: 'Blue/600',
        resolvedType: 'COLOR',
        variableCollectionId: 'p',
        valuesByMode: { v: { r: 0.2353, g: 0.4, b: 0.5059, a: 1 } },
      },
      w: {
        id: 'w',
        name: 'White',
        resolvedType: 'COLOR',
        variableCollectionId: 'p',
        valuesByMode: { v: { r: 1, g: 1, b: 1, a: 1 } },
      },
      brand: {
        id: 'brand',
        name: 'Color/Brand',
        resolvedType: 'COLOR',
        variableCollectionId: 's',
        codeSyntax: { WEB: 'var(--brand)' },
        valuesByMode: { l: { type: 'VARIABLE_ALIAS', id: 'b' }, d: { type: 'VARIABLE_ALIAS', id: 'w' } },
      },
      r: {
        id: 'r',
        name: 'Radius/Card',
        resolvedType: 'FLOAT',
        variableCollectionId: 'p',
        scopes: ['CORNER_RADIUS'],
        valuesByMode: { v: 12 },
      },
      txt: {
        id: 'txt',
        name: 'Copy/Welcome',
        resolvedType: 'STRING',
        variableCollectionId: 'p',
        valuesByMode: { v: 'Hello' },
      },
    },
  },
}

const PEN = `{
  // pen.dev library
  "themes": { "mode": ["light", "dark"] },
  "variables": {
    "--primary": { "type": "color", "value": [{ "value": "#3c6681" }, { "value": "#9fc0d6", "theme": { "mode": "dark" } }] },
    "--radius": { "type": "number", "value": 8 },
    "--font-sans": { "type": "string", "value": "Inter" }
  },
  "children": []
}`

describe('accord init --from design', () => {
  let root = ''
  afterEach(() => rm(root, { recursive: true, force: true }))
  const init = async (extra: { figma?: string[]; mode?: string } = {}) => {
    const out: string[] = []
    const code = await initCommand(
      { root, register: '.accord', force: false, dryRun: false, from: 'design', ...extra },
      t,
      (s) => out.push(s),
    )
    return { code, out: out.join('\n') }
  }

  it('creates the register from a Figma export, keeps aliases and records Figma as synced', async () => {
    root = await mkdtemp(join(tmpdir(), 'accord-design-'))
    await mkdir(join(root, 'figma'))
    await writeFile(join(root, 'figma', 'variables.json'), JSON.stringify(REST))
    const { code, out } = await init()
    expect(code).toBe(0)
    expect(out).toContain('Figma (5 variables from 1 file(s))')
    // The Dark mode is a context of the register now, no longer "follows with modes".
    expect(out).toContain('Modes: light, dark from Figma (Semantic)')
    expect(out).toContain(
      '1 variable(s) without a token type not taken over (text, boolean), e.g. Copy.Welcome',
    )

    const register = await loadValidRegister(join(root, '.accord'))
    expect(register.tokens.get('color.brand')?.aliasOf).toBe('blue.600')
    expect(register.tokens.get('color.brand')?.accord?.ids).toEqual({ figma: 'Color.Brand', css: '--brand' })
    expect(register.tokens.get('radius.card')?.value).toEqual({ value: 12, unit: 'px' })
    expect(register.config.surfaces.figma.enabled).toBe(true)
    // Colours live in two groups (blue, color): the colour scale covers both.
    expect(register.decisions.get('D-002')?.scope).toEqual(['tokens.**'])
    const lock = parseLock(await readFile(join(root, '.accord', 'surfaces.lock.json'), 'utf8'))
    expect(Object.keys(lock.surfaces.figma?.snapshot.tokens ?? {})).toHaveLength(4)

    const status = async () => {
      const lines: string[] = []
      const c = await figmaCommand({ root, register: '.accord', action: 'status', json: false }, t, (s) =>
        lines.push(s),
      )
      return { c, text: lines.join('\n') }
    }
    expect((await status()).c).toBe(0)
    // A designer changes the radius in Figma: Accord knows the change came from Figma.
    const changed = structuredClone(REST)
    changed.meta.variables.r.valuesByMode.v = 16
    await writeFile(join(root, 'figma', 'variables.json'), JSON.stringify(changed))
    const after = await status()
    expect(after.c).toBe(1)
    expect(after.text).toContain('tokens.radius.card  [changed in Figma]')
  })

  it('takes a folder of per-collection mode files via --figma', async () => {
    root = await mkdtemp(join(tmpdir(), 'accord-design-'))
    const dir = join(root, 'tokens', 'FileKey')
    await mkdir(dir, { recursive: true })
    const radius = (value: number) =>
      JSON.stringify({
        radius: { $type: 'number', $value: value, $extensions: { 'com.figma.scopes': ['CORNER_RADIUS'] } },
      })
    await writeFile(join(dir, '⭕️ Border radius.Rounded.json'), radius(4))
    await writeFile(join(dir, '⭕️ Border radius.Pill.json'), radius(999))
    const { code, out } = await init({ figma: ['tokens/FileKey'], mode: 'rounded' })
    expect(code).toBe(0)
    expect(out).toContain('mode Rounded taken over (⭕️ Border radius); Pill follow with modes')
    const register = await loadValidRegister(join(root, '.accord'))
    expect(register.tokens.get('radius')).toBeUndefined()
    expect(register.tokens.get('dimension.radius')?.value).toEqual({ value: 4, unit: 'px' })
    // Without colour tokens there is no colour scale decision.
    expect(register.decisions.has('D-002')).toBe(false)
    expect(register.config.surfaces.figma.include).toEqual(['tokens/FileKey/**/*.json'])
  })

  it('creates the register from Pencil files and links CSS-named variables to code', async () => {
    root = await mkdtemp(join(tmpdir(), 'accord-design-'))
    await writeFile(join(root, 'library.pen'), PEN)
    const { code, out } = await init()
    expect(code).toBe(0)
    expect(out).toContain('Pencil (3 variables from 1 .pen file(s))')
    expect(out).toContain('Modes: light, dark from Pencil (axis mode)')
    const register = await loadValidRegister(join(root, '.accord'))
    expect(register.tokens.get('color.primary')?.accord?.ids).toEqual({ pen: '--primary', css: '--primary' })
    expect(register.tokens.get('dimension.radius')?.value).toEqual({ value: 8, unit: 'px' })
    expect(register.tokens.get('font-family.font-sans')?.value).toBe('Inter')
    const lines: string[] = []
    expect(
      await penCommand({ root, register: '.accord', action: 'status', json: false }, t, (s) => lines.push(s)),
    ).toBe(0)
  })

  it('says what to do when there is no design source', async () => {
    root = await mkdtemp(join(tmpdir(), 'accord-design-'))
    await expect(init()).rejects.toBeInstanceOf(AccordError)
  })

  it('starts from a .fig file on its own when there is nothing else', async () => {
    root = await mkdtemp(join(tmpdir(), 'accord-design-'))
    const id = (localID: number) => ({ sessionID: 1, localID })
    const nodes = [
      {
        guid: id(1),
        type: 'VARIABLE_SET',
        name: 'Tokens',
        variableSetModes: [{ id: id(2), name: 'Value', sortPosition: '!' }],
      },
      {
        guid: id(3),
        type: 'VARIABLE',
        name: 'Color/Brand',
        variableSetID: { guid: id(1) },
        variableResolvedType: 'COLOR',
        codeSyntax: { entries: [{ platform: 'WEB', value: 'var(--brand)' }] },
        variableDataValues: {
          entries: [
            {
              modeID: id(2),
              variableData: { value: { colorValue: { r: 0.2353, g: 0.4, b: 0.5059, a: 1 } } },
            },
          ],
        },
      },
    ]
    await mkdir(join(root, 'design'))
    await writeFile(
      join(root, 'design', 'Brand System.fig'),
      zip({ 'canvas.fig': canvas(FIG_SCHEMA, { nodeChanges: nodes }) }),
    )
    const out: string[] = []
    const code = await initCommand({ root, register: '.accord', force: false, dryRun: false }, t, (s) =>
      out.push(s),
    )
    expect(code).toBe(0)
    expect(out.join('\n')).toContain('Figma files and exports: design/Brand System.fig')
    expect(out.join('\n')).toContain('there are only design sources')
    const register = await loadValidRegister(join(root, '.accord'))
    expect(register.tokens.get('color.brand')?.accord?.ids).toEqual({ figma: 'Color.Brand', css: '--brand' })
    const status: string[] = []
    expect(
      await figmaCommand({ root, register: '.accord', action: 'status', json: false }, t, (s) =>
        status.push(s),
      ),
    ).toBe(0)
    expect(status.join('\n')).toContain('1 tokens compared')
  })
})
