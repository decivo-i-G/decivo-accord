import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadValidRegister } from '@decivo/accord-core/node'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyCommand, figmaCommand, initCommand } from '../src/commands.js'
import { translator } from '../src/messages.js'
import type { SurfaceProposal } from '../src/surface-proposal.js'

const t = translator('en')
const rgb = (hex: string) => ({
  r: Number.parseInt(hex.slice(1, 3), 16) / 255,
  g: Number.parseInt(hex.slice(3, 5), 16) / 255,
  b: Number.parseInt(hex.slice(5, 7), 16) / 255,
  a: 1,
})

type Variables = Record<string, Record<string, unknown>>
const figma = (variables: Variables) => ({
  meta: {
    variableCollections: { p: { id: 'p', name: 'Primitives', modes: [{ modeId: 'v', name: 'Value' }] } },
    variables,
  },
})
const color = (id: string, name: string, hex: string) => ({
  id,
  name,
  resolvedType: 'COLOR',
  variableCollectionId: 'p',
  valuesByMode: { v: rgb(hex) },
})
const BASE: Variables = {
  b: color('b', 'Blue/600', '#3c6681'),
  brand: {
    id: 'brand',
    name: 'Color/Brand',
    resolvedType: 'COLOR',
    variableCollectionId: 'p',
    valuesByMode: { v: { type: 'VARIABLE_ALIAS', id: 'b' } },
  },
  r: {
    id: 'r',
    name: 'Radius/Card',
    resolvedType: 'FLOAT',
    variableCollectionId: 'p',
    scopes: ['CORNER_RADIUS'],
    valuesByMode: { v: 12 },
  },
}

describe('Figma changes become proposals, a person decides', () => {
  let root = ''
  const save = (variables: Variables) =>
    writeFile(join(root, 'figma', 'variables.json'), JSON.stringify(figma(variables)))
  const run = async (fn: (print: (s: string) => void) => Promise<number>) => {
    const out: string[] = []
    const code = await fn((s) => out.push(s))
    return { code, out: out.join('\n') }
  }
  const figmaRun = (action: 'status' | 'propose' | 'lock', write = false, json = false) =>
    run((print) => figmaCommand({ root, register: '.accord', action, json, write }, t, print))
  const adopt = (proposal: string) =>
    run((print) =>
      applyCommand(
        {
          root,
          register: '.accord',
          proposal,
          option: 'adopt',
          by: 'Dana',
          dryRun: false,
          branch: false,
          push: false,
          json: false,
        },
        t,
        print,
      ),
    )
  const proposals = async () => {
    const { out } = await figmaRun('propose', false, true)
    return JSON.parse(out) as SurfaceProposal
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'accord-propose-'))
    await mkdir(join(root, 'figma'))
    await save(BASE)
    await initCommand({ root, register: '.accord', force: false, dryRun: false }, t, () => {})
  })
  afterEach(() => rm(root, { recursive: true, force: true }))

  it('nothing to propose right after init', async () => {
    const { code, out } = await figmaRun('propose')
    expect(code).toBe(0)
    expect(out).toContain('Nothing to propose')
  })

  it('a value the designers own goes through without a person; adopting it updates register and changelog', async () => {
    await save({ ...BASE, r: { ...BASE.r, valuesByMode: { v: 16 } } })
    const p = await proposals()
    expect(p.route).toBe('auto')
    expect(p.changes).toEqual([
      {
        token: 'radius.card',
        kind: 'change',
        type: 'dimension',
        before: '12px',
        after: '16px',
        origin: 'surface',
        owner: 'design',
      },
    ])

    const written = await figmaRun('propose', true)
    expect(written.out).toContain(`accord apply --proposal ${p.id}`)
    const applied = await adopt(p.id)
    expect(applied.code).toBe(0)
    expect(applied.out).toContain('radius.card: 12px → 16px')
    const register = await loadValidRegister(join(root, '.accord'))
    expect(register.tokens.get('radius.card')?.value).toEqual({ value: 16, unit: 'px' })
    const changelog = await readFile(join(root, '.accord', 'generated', 'CHANGELOG.md'), 'utf8').catch(() =>
      readFile(join(root, 'CHANGELOG.md'), 'utf8'),
    )
    expect(changelog).toContain(`**Adopted** \`${p.id}\` (figma), decided by Dana`)
    // Register and Figma agree again.
    expect((await figmaRun('status')).out).toContain('No differences to the register.')
  })

  it('a new shade is a decision for the colour owners (D-002), which they can take', async () => {
    await save({ ...BASE, b: color('b', 'Blue/600', '#2f5a74') })
    const p = await proposals()
    expect(p.route).toBe('owner')
    expect(p.decider).toBe('design')
    expect(p.violations.map((v) => v.decision)).toEqual(['D-002'])
    // The brand colour points to blue.600 and follows it; only the primitive is a change.
    expect(p.changes.map((c) => c.token)).toEqual(['blue.600'])
    await figmaRun('propose', true)
    expect((await adopt(p.id)).code).toBe(0)
    expect((await loadValidRegister(join(root, '.accord'))).tokens.get('blue.600')?.value).toMatchObject({
      hex: '#2f5a74',
    })
  })

  it('a deletion in Figma is shown and always goes to a person', async () => {
    const { r: _gone, ...rest } = BASE
    await save(rest)
    const status = await figmaRun('status')
    expect(status.out).toContain('tokens.radius.card  [deleted in Figma]')
    const p = await proposals()
    expect(p.route).toBe('owner')
    expect(p.reasons.map((r) => r.code)).toContain('deletion')
    expect(p.changes[0]).toMatchObject({ token: 'radius.card', kind: 'remove', before: '12px' })

    await figmaRun('propose', true)
    const applied = await run((print) =>
      applyCommand(
        {
          root,
          register: '.accord',
          proposal: p.id,
          option: 'adopt',
          by: 'Dana',
          dryRun: false,
          branch: false,
          push: false,
          json: false,
        },
        t,
        print,
      ),
    )
    expect(applied.out).toContain('radius.card: removed (was 12px)')
    expect((await loadValidRegister(join(root, '.accord'))).tokens.has('radius.card')).toBe(false)
  })

  it('a new variable is a proposal for a new name, which the register owns', async () => {
    await save({ ...BASE, a: color('a', 'Color/Accent', '#c2410c') })
    const p = await proposals()
    expect(p.route).toBe('owner')
    // Names and existence belong to the register, whatever group rules say.
    expect(p.reasons.map((r) => r.code)).toContain('register_owned')
    expect(p.changes).toEqual([
      expect.objectContaining({
        token: 'color.accent',
        kind: 'new',
        after: '#c2410c',
        variable: 'Color.Accent',
      }),
    ])
  })

  it('reset keeps the register and records the decision', async () => {
    await save({ ...BASE, b: color('b', 'Blue/600', '#ff0000') })
    const p = await proposals()
    await figmaRun('propose', true)
    const applied = await run((print) =>
      applyCommand(
        {
          root,
          register: '.accord',
          proposal: p.id,
          option: 'reset',
          by: 'Dana',
          note: 'Off-brand',
          dryRun: false,
          branch: false,
          push: false,
          json: false,
        },
        t,
        print,
      ),
    )
    expect(applied.code).toBe(0)
    expect((await loadValidRegister(join(root, '.accord'))).tokens.get('blue.600')?.value).toMatchObject({
      hex: '#3c6681',
    })
    const saved = JSON.parse(await readFile(join(root, '.accord', 'proposals', `${p.id}.json`), 'utf8'))
    expect(saved.resolution).toMatchObject({ option: 'reset', by: 'Dana', note: 'Off-brand' })
  })
})
