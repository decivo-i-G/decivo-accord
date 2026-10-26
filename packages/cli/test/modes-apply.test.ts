import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ColorValue, colorToHex, registerInContext } from '@decivo/accord-core'
import { loadValidRegister } from '@decivo/accord-core/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ResolutionSchema } from '../src/apply.js'
import { applyCommand, figmaCommand, initCommand, penCommand } from '../src/commands.js'
import { translator } from '../src/messages.js'

const t = translator('en')
const rgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
  return { r, g, b, a: 1 }
}

/** Figma variables: primitives and a Light/Dark theme with aliases, as the REST API returns them. */
const figma = (dark: { background: string; text: string }) => ({
  meta: {
    variableCollections: {
      p: { id: 'p', name: 'Primitives', defaultModeId: 'v', modes: [{ modeId: 'v', name: 'Value' }] },
      t: {
        id: 't',
        name: 'Theme',
        defaultModeId: 'l',
        modes: [
          { modeId: 'l', name: 'Light' },
          { modeId: 'd', name: 'Dark' },
        ],
      },
    },
    variables: {
      g50: {
        id: 'g50',
        name: 'Gray/50',
        resolvedType: 'COLOR',
        variableCollectionId: 'p',
        valuesByMode: { v: rgb('#fafafa') },
      },
      g950: {
        id: 'g950',
        name: 'Gray/950',
        resolvedType: 'COLOR',
        variableCollectionId: 'p',
        valuesByMode: { v: rgb('#0a0a0a') },
      },
      bg: {
        id: 'bg',
        name: 'Color/Background',
        resolvedType: 'COLOR',
        variableCollectionId: 't',
        codeSyntax: { WEB: 'var(--background)' },
        valuesByMode: { l: { type: 'VARIABLE_ALIAS', id: 'g50' }, d: rgb(dark.background) },
      },
      text: {
        id: 'text',
        name: 'Color/Text',
        resolvedType: 'COLOR',
        variableCollectionId: 't',
        codeSyntax: { WEB: 'var(--text)' },
        valuesByMode: { l: { type: 'VARIABLE_ALIAS', id: 'g950' }, d: rgb(dark.text) },
      },
    },
  },
})

describe('a dark value changed in Figma becomes a proposal and, once decided, the dark context', () => {
  let root = ''
  const run = async (fn: (print: (s: string) => void) => Promise<number>) => {
    const out: string[] = []
    const code = await fn((s) => out.push(s))
    return { code, text: out.join('\n') }
  }
  const save = (dark: { background: string; text: string }) =>
    writeFile(join(root, 'figma/variables.json'), JSON.stringify(figma(dark)))
  const common = () => ({ root, register: '.accord', json: false })
  const proposals = async () =>
    (await readdir(join(root, '.accord/proposals'))).filter((f) => f.endsWith('.json'))

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'accord-modes-apply-'))
    await mkdir(join(root, 'figma'))
    await save({ background: '#0a0a0a', text: '#fafafa' })
    const init = await run((p) =>
      initCommand({ root, register: '.accord', force: false, dryRun: false, from: 'design' }, t, p),
    )
    expect(init.code).toBe(0)
    expect(init.text).toContain('Modes: light, dark from Figma (Theme)')
  })
  afterAll(() => rm(root, { recursive: true, force: true }))

  it('starts in sync in light and dark', async () => {
    const status = await run((p) => figmaCommand({ ...common(), action: 'status' }, t, p))
    expect(status.code).toBe(0)
    expect(status.text).toContain('Modes: Light, Dark (compared: Light, Dark)')
    expect(status.text).not.toContain('theme values')
  })

  it('status and propose name the context; apply writes the dark file and the changelog says dark', async () => {
    await save({ background: '#111827', text: '#fafafa' })
    const status = await run((p) => figmaCommand({ ...common(), action: 'status' }, t, p))
    expect(status.code).toBe(1)
    expect(status.text).toContain('tokens.color.background (dark)  [changed in Figma]  #0a0a0a → #111827')

    const propose = await run((p) => figmaCommand({ ...common(), action: 'propose', write: true }, t, p))
    expect(propose.text).toContain('color.background (dark): #0a0a0a → #111827')
    const [file] = await proposals()
    const proposal = JSON.parse(await readFile(join(root, '.accord/proposals', file as string), 'utf8'))
    expect(proposal.changes).toEqual([
      expect.objectContaining({
        token: 'color.background',
        kind: 'change',
        context: 'dark',
        after: '#111827',
      }),
    ])
    // A new colour is a decision of design (D-002), in dark as in light.
    expect(proposal.route).toBe('owner')

    const apply = await run((p) =>
      applyCommand(
        {
          ...common(),
          proposal: proposal.id,
          option: 'adopt',
          by: 'Dana',
          dryRun: false,
          branch: false,
          push: false,
        },
        t,
        p,
      ),
    )
    expect(apply.code).toBe(0)
    expect(apply.text).toContain('color.background (dark): #0a0a0a → #111827')
    const register = await loadValidRegister(join(root, '.accord'))
    expect(
      colorToHex(registerInContext(register, 'dark').tokens.get('color.background')?.value as ColorValue),
    ).toBe('#111827')
    // Light stays as it was.
    expect(colorToHex(register.tokens.get('color.background')?.value as ColorValue)).toBe('#fafafa')
    const changelog = await readFile(join(root, '.accord/generated/CHANGELOG.md'), 'utf8')
    expect(changelog).toContain('`color.background` (dark): #111827')
  })

  it('a dark value deleted in Figma is a deletion for a person; adopting it removes the own dark value', async () => {
    await save({ background: '#111827', text: '#0a0a0a' })
    const propose = await run((p) => figmaCommand({ ...common(), action: 'propose', write: true }, t, p))
    expect(propose.text).toContain('deletion (always a person)')
    expect(propose.text).toContain('color.text (dark): own dark value deleted in the tool (was #fafafa)')
    const decided = new Set<string>()
    for (const f of await proposals()) {
      const p = JSON.parse(await readFile(join(root, '.accord/proposals', f), 'utf8'))
      if (p.resolution) decided.add(p.id)
      else {
        expect(p.changes).toEqual([
          expect.objectContaining({ token: 'color.text', kind: 'remove', context: 'dark' }),
        ])
        const apply = await run((print) =>
          applyCommand(
            {
              ...common(),
              proposal: p.id,
              option: 'adopt',
              by: 'Dana',
              dryRun: false,
              branch: false,
              push: false,
            },
            t,
            print,
          ),
        )
        expect(apply.code).toBe(0)
        expect(apply.text).toContain(
          'color.text (dark): own value removed (was #fafafa); the default value applies',
        )
      }
    }
    expect(decided.size).toBe(1)
    const register = await loadValidRegister(join(root, '.accord'))
    expect(register.modes?.own.get('dark')?.has('color.text')).toBe(false)
    const changelog = await readFile(join(root, '.accord/generated/CHANGELOG.md'), 'utf8')
    expect(changelog).toContain('`color.text` (dark): own value removed, the default value applies')
  })

  it('refuses a new token in a context: tokens exist in every context alike', () => {
    const parsed = ResolutionSchema.safeParse({
      schema: 'accord.resolution/1',
      proposal: 'P-20261026-x',
      option: 'adopt',
      items: [{ token: 'color.new', kind: 'new', value: '#000000', context: 'dark' }],
      by: 'Dana',
      at: '2026-10-26T10:00:00Z',
    })
    expect(parsed.success).toBe(false)
  })
})

describe('Pencil themes in status', () => {
  it('compares mode: dark after init and lists other theme axes as not compared', async () => {
    const root = await mkdtemp(join(tmpdir(), 'accord-pen-modes-'))
    try {
      const doc = (dark: string) =>
        JSON.stringify({
          themes: { mode: ['light', 'dark'], density: ['regular', 'compact'] },
          variables: {
            '--primary': {
              type: 'color',
              value: [{ value: '#3c6681' }, { value: dark, theme: { mode: 'dark' } }],
            },
            '--gap': { type: 'number', value: [{ value: 16 }, { value: 8, theme: { density: 'compact' } }] },
          },
          children: [],
        })
      await writeFile(join(root, 'library.pen'), doc('#9fc0d6'))
      await initCommand({ root, register: '.accord', force: false, dryRun: false }, t, () => {})
      await writeFile(join(root, 'library.pen'), doc('#b3d1e4'))
      const out: string[] = []
      expect(
        await penCommand({ root, register: '.accord', action: 'status', json: false }, t, (s) => out.push(s)),
      ).toBe(1)
      const text = out.join('\n')
      expect(text).toContain('Also compared in: dark')
      expect(text).toContain('tokens.color.primary (dark)  [changed in Pencil]  #9fc0d6 → #b3d1e4')
      expect(text).toContain(
        '1 token(s) with theme values in modes the register does not have (not compared)',
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
