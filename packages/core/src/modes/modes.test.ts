import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type ChangeOp, classify, diffSnapshots } from '../diff/diff.js'
import {
  restrictTo,
  type Snapshot,
  type SnapshotToken,
  snapshotFromRegister,
  tokensDifferingIn,
} from '../diff/snapshot.js'
import { threeWayDiff } from '../diff/three-way.js'
import { colorToHex, cssToColor } from '../dtcg/color.js'
import type { ColorValue } from '../dtcg/types.js'
import { applyTokenEdits } from '../edit.js'
import { lockedSnapshot, parseLock, serializeLock, withLockedSnapshot } from '../lock.js'
import { readRegisterFiles } from '../node.js'
import { buildRegister, type Register, type RegisterFile } from '../register.js'
import { otherContexts, registerInContext, setsInContext, tokensInContext } from './contexts.js'
import { contextKey, parseContextKey, refPath, resolverDocument } from './resolver.js'

const fixture = fileURLToPath(new URL('../../test/fixtures/modes/.accord', import.meta.url))

const hex = (register: Pick<Register, 'tokens'>, path: string) =>
  colorToHex(register.tokens.get(path)?.value as ColorValue)
const color = (h: string) => ({ $value: cssToColor(h) })
const codes = (register: Register) => register.issues.map((i) => i.code)
const errors = (register: Register) => register.issues.filter((i) => i.severity === 'error')

const CONFIG: RegisterFile = { path: 'accord.config.yaml', content: 'version: 1\n' }
const TOKENS: RegisterFile = {
  path: 'tokens/color.tokens.json',
  content: JSON.stringify({
    color: {
      $type: 'color',
      gray: { '50': color('#fafafa'), '900': color('#171717') },
      background: color('#ffffff'),
      foreground: color('#0a0a0a'),
      text: { $value: '{color.foreground}' },
      brand: color('#3c6681'),
    },
  }),
}
const dark = (content: unknown, path = 'modes/theme/dark.tokens.json'): RegisterFile => ({
  path,
  content: JSON.stringify(content),
})
const resolver = (doc: unknown): RegisterFile => ({ path: 'resolver.json', content: JSON.stringify(doc) })
const THEME = (
  contexts: Record<string, unknown[]> = { light: [], dark: [{ $ref: 'modes/theme/dark.tokens.json' }] },
) => ({
  version: '2025.10',
  sets: { core: { sources: [{ $ref: 'tokens/color.tokens.json' }] } },
  modifiers: { theme: { contexts, default: 'light' } },
  resolutionOrder: [{ $ref: '#/sets/core' }, { $ref: '#/modifiers/theme' }],
})
const DARK = dark({ color: { background: color('#0a0a0a'), foreground: color('#fafafa') } })

describe('register modes (DTCG resolver)', () => {
  it('leaves a register without resolver.json exactly as before', () => {
    const register = buildRegister([CONFIG, TOKENS])
    expect(register.issues).toEqual([])
    expect('modes' in register).toBe(false)
    expect(snapshotFromRegister(register).coverage).toEqual({ tokens: ['**'], components: expect.any(Array) })
    expect(snapshotFromRegister(register).contexts).toBeUndefined()
  })

  it('resolves every context: own values, fallbacks and aliases that follow their target', () => {
    const register = buildRegister([CONFIG, TOKENS, resolver(THEME()), DARK])
    expect(register.issues).toEqual([])
    const modes = register.modes
    expect(modes).toMatchObject({ modifier: 'theme', default: 'light', contexts: ['light', 'dark'] })
    expect(otherContexts(register)).toEqual(['dark'])
    const inDark = registerInContext(register, { theme: 'dark' })
    expect(hex(inDark, 'color.background')).toBe('#0a0a0a')
    // Not set in dark: falls back to the light value.
    expect(hex(inDark, 'color.brand')).toBe('#3c6681')
    // An alias resolves within the context.
    expect(hex(inDark, 'color.text')).toBe('#fafafa')
    expect(hex(register, 'color.text')).toBe('#0a0a0a')
    expect(setsInContext(register, 'dark', 'color.background')).toBe(true)
    expect(setsInContext(register, 'dark', 'color.text')).toBe(false)
    // The default context is the token files themselves.
    expect(tokensInContext(register, { theme: 'light' })).toBe(register.tokens)
    expect(registerInContext(register, undefined)).toBe(register)
  })

  it('takes types from the register and lets a context alias other tokens', () => {
    const register = buildRegister([
      CONFIG,
      TOKENS,
      resolver(THEME()),
      dark({ color: { brand: { $value: '{color.gray.50}' } } }),
    ])
    expect(register.issues).toEqual([])
    const brand = tokensInContext(register, 'dark').get('color.brand')
    expect(brand).toMatchObject({ type: 'color', aliasOf: 'color.gray.50' })
    expect(colorToHex(brand?.value as ColorValue)).toBe('#fafafa')
  })

  it('accepts more contexts than light and dark (high contrast) without a format change', () => {
    const register = buildRegister([
      CONFIG,
      TOKENS,
      DARK,
      dark({ color: { foreground: color('#000000') } }, 'modes/theme/high-contrast.tokens.json'),
      resolver(
        THEME({
          light: [],
          dark: [{ $ref: 'modes/theme/dark.tokens.json' }],
          'high-contrast': [{ $ref: './modes/theme/high-contrast.tokens.json' }],
        }),
      ),
    ])
    expect(errors(register)).toEqual([])
    expect(otherContexts(register)).toEqual(['dark', 'high-contrast'])
    expect(hex(registerInContext(register, 'high-contrast'), 'color.text')).toBe('#000000')
  })

  it('lists the tokens that differ in a context, own values and aliases that follow them', () => {
    const register = buildRegister([CONFIG, TOKENS, resolver(THEME()), DARK])
    expect(tokensDifferingIn(register, 'dark').map((t) => t.path)).toEqual([
      'color.background',
      'color.foreground',
      'color.text',
    ])
    expect(tokensDifferingIn(register, 'light')).toEqual([])
    expect(tokensDifferingIn(buildRegister([CONFIG, TOKENS]), 'dark')).toEqual([])
  })

  it('reads the fixture from disk', async () => {
    const files = await readRegisterFiles(fixture)
    expect(files.map((f) => f.path)).toContain('modes/theme/dark.tokens.json')
    const register = buildRegister(files)
    expect(register.issues).toEqual([])
    const inDark = registerInContext(register, 'dark')
    expect(hex(inDark, 'color.primary')).toBe('#fafafa')
    expect(hex(register, 'color.primary')).toBe('#171717')
    expect(register.modes?.own.get('dark')?.size).toBe(6)
  })
})

describe('resolver.json validation', () => {
  const build = (doc: unknown, extra: RegisterFile[] = [DARK]) =>
    buildRegister([CONFIG, TOKENS, resolver(doc), ...extra])

  it('rejects what is not a 2025.10 resolver', () => {
    expect(codes(build({ ...THEME(), version: '1.0' }))).toContain('schema')
    expect(codes(buildRegister([CONFIG, TOKENS, { path: 'resolver.json', content: '{' }]))).toContain('json')
  })

  it('names modifiers other than theme as not supported yet (F13), instead of ignoring them', () => {
    const doc = THEME()
    const register = build({
      ...doc,
      modifiers: { ...doc.modifiers, brand: { contexts: { acme: [] }, default: 'acme' } },
      resolutionOrder: [...doc.resolutionOrder, { $ref: '#/modifiers/brand' }],
    })
    expect(codes(register)).toContain('resolver-unsupported-modifier')
    expect(register.modes).toBeUndefined()
  })

  it('checks the default context and the files of every context', () => {
    expect(
      codes(
        build({ ...THEME(), modifiers: { theme: { contexts: { light: [], dark: [] }, default: 'dim' } } }),
      ),
    ).toContain('resolver-default')
    expect(codes(build(THEME({ light: [{ $ref: 'modes/theme/dark.tokens.json' }], dark: [] })))).toContain(
      'resolver-default-sources',
    )
    expect(codes(build(THEME({ light: [], dark: [{ $ref: 'modes/theme/missing.tokens.json' }] })))).toContain(
      'resolver-missing-file',
    )
    expect(codes(build(THEME({ light: [], dark: [{ $ref: 'tokens/color.tokens.json' }] })))).toContain(
      'resolver-context-file',
    )
    expect(codes(build(THEME({ light: [], dark: [{ color: {} }] })))).toContain('resolver-inline-source')
    expect(codes(build(THEME({ light: [], dark: [{ $ref: 'https://example.com/dark.json' }] })))).toContain(
      'resolver-ref',
    )
    expect(codes(build(THEME({ light: [], 'dark mode': [] })))).toContain('resolver-context-name')
  })

  it('wants the sets before the modifier, and every token file in a set', () => {
    const doc = THEME()
    expect(codes(build({ ...doc, resolutionOrder: [...doc.resolutionOrder].reverse() }))).toContain(
      'resolver-order',
    )
    const register = buildRegister([
      CONFIG,
      TOKENS,
      {
        path: 'tokens/radius.tokens.json',
        content: JSON.stringify({ radius: { $type: 'dimension', md: { $value: { value: 8, unit: 'px' } } } }),
      },
      resolver(doc),
      DARK,
    ])
    expect(register.issues).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'resolver-missing-set-file' }),
    ])
    expect(register.modes).toBeDefined()
  })

  it('reports values a context cannot hold, in the context file', () => {
    const register = build(THEME(), [
      dark({
        color: {
          unknown: color('#000000'),
          background: { $type: 'dimension', $value: { value: 1, unit: 'px' } },
          foreground: { $value: '#fff' },
          brand: { $value: '{color.nowhere}' },
        },
      }),
    ])
    const found = errors(register).map((i) => [i.code, i.file, i.path])
    expect(found).toEqual(
      expect.arrayContaining([
        ['context-unknown-token', 'modes/theme/dark.tokens.json', 'color.unknown'],
        ['context-type', 'modes/theme/dark.tokens.json', 'color.background'],
        ['invalid-value', 'modes/theme/dark.tokens.json', 'color.foreground'],
        ['broken-reference', 'modes/theme/dark.tokens.json', 'color.brand'],
      ]),
    )
    expect(errors(register).find((i) => i.code === 'invalid-value')?.message).toMatch(/^in context dark: /)
  })

  it('warns about mode files nothing uses', () => {
    expect(buildRegister([CONFIG, TOKENS, DARK]).issues).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'unreferenced-mode-file' }),
    ])
  })

  it('resolves refs relative to the register root only', () => {
    expect(refPath('./modes/theme/dark.tokens.json')).toBe('modes/theme/dark.tokens.json')
    expect(refPath('modes/../tokens/a.json')).toBe('tokens/a.json')
    expect(refPath('../outside.json')).toBeUndefined()
    expect(refPath('a.json#/color')).toBeUndefined()
  })

  it('writes the document accord init needs', () => {
    const doc = resolverDocument({
      tokenFiles: ['tokens/color.tokens.json'],
      contexts: ['light', 'dark'],
      default: 'light',
      files: new Map([['dark', 'modes/theme/dark.tokens.json']]),
    })
    const register = buildRegister([CONFIG, TOKENS, DARK, resolver(doc)])
    expect(register.issues).toEqual([])
    expect(register.modes?.contexts).toEqual(['light', 'dark'])
  })

  it('keys contexts canonically', () => {
    expect(contextKey({ theme: 'dark' })).toBe('theme=dark')
    expect(contextKey({ theme: 'dark', brand: 'acme' })).toBe('brand=acme,theme=dark')
    expect(parseContextKey('brand=acme,theme=dark')).toEqual({ theme: 'dark', brand: 'acme' })
  })
})

// --- diff per context ---

const c = (h: string): SnapshotToken => ({ type: 'color', value: cssToColor(h) })
const surface = (tokens: Record<string, SnapshotToken>, dark?: Record<string, SnapshotToken>): Snapshot => ({
  tokens: new Map(Object.entries(tokens)),
  components: new Map(),
  coverage: {
    tokens: Object.keys(tokens),
    components: [],
    ...(dark ? { contexts: ['theme=dark'] } : {}),
  },
  ...(dark ? { contexts: new Map([['theme=dark', new Map(Object.entries(dark))]]) } : {}),
})
const describeOps = (ops: ChangeOp[]) =>
  ops.map((o) =>
    o.kind === 'token.value_changed'
      ? `${o.path}${o.context ? `@${contextKey(o.context)}` : ''} ${colorToHex(o.before as ColorValue)}→${colorToHex(o.after as ColorValue)}${o.fallback ? ` (${o.fallback} falls back)` : ''}`
      : `${o.kind} ${o.path}`,
  )

describe('diff per context', () => {
  const register = buildRegister([CONFIG, TOKENS, resolver(THEME()), DARK])
  const light = {
    'color.background': c('#ffffff'),
    'color.foreground': c('#0a0a0a'),
    'color.brand': c('#3c6681'),
  }

  it('snapshots the register with its own values per context', () => {
    const snap = snapshotFromRegister(register)
    expect(snap.coverage.contexts).toEqual(['theme=dark'])
    // background and foreground are set in dark; text follows foreground through its alias.
    expect([...(snap.contexts?.get('theme=dark')?.keys() ?? [])].sort()).toEqual([
      'color.background',
      'color.foreground',
      'color.text',
    ])
  })

  it('finds a changed dark value and reports it with its context', () => {
    const ops = diffSnapshots(
      restrictTo(snapshotFromRegister(register), surface(light, {}).coverage),
      surface(light, { 'color.background': c('#111111'), 'color.foreground': c('#fafafa') }),
    )
    expect(describeOps(ops)).toEqual(['tokens.color.background@theme=dark #0a0a0a→#111111'])
    expect(ops[0]).toMatchObject({ context: { theme: 'dark' } })
    expect(classify(ops[0] as ChangeOp)).toMatchObject({ breaking: false, deletion: false, aspect: 'value' })
  })

  it('tells a new own value from a removed one; removing a context value is a deletion', () => {
    const ops = diffSnapshots(
      restrictTo(snapshotFromRegister(register), surface(light, {}).coverage),
      surface(light, { 'color.background': c('#0a0a0a'), 'color.brand': c('#9fc0d6') }),
    )
    expect(describeOps(ops)).toEqual([
      'tokens.color.foreground@theme=dark #fafafa→#0a0a0a (after falls back)',
      'tokens.color.brand@theme=dark #3c6681→#9fc0d6 (before falls back)',
    ])
    expect(classify(ops[0] as ChangeOp)).toMatchObject({ deletion: true, breaking: false, aspect: 'value' })
    expect(classify(ops[1] as ChangeOp)).toMatchObject({ deletion: false })
  })

  it('reports a default difference once, not again in every context that falls back', () => {
    const ops = diffSnapshots(
      restrictTo(snapshotFromRegister(register), surface(light, {}).coverage),
      surface(
        { ...light, 'color.brand': c('#487a98') },
        { 'color.background': c('#0a0a0a'), 'color.foreground': c('#fafafa') },
      ),
    )
    expect(describeOps(ops)).toEqual(['tokens.color.brand #3c6681→#487a98'])
  })

  it('compares no context the other side does not carry', () => {
    // A surface without dark values (e.g. a CSS file without a .dark block).
    expect(
      diffSnapshots(restrictTo(snapshotFromRegister(register), surface(light).coverage), surface(light)),
    ).toEqual([])
    // A register without modes against a surface with dark values: compared as before, light only.
    const plain = buildRegister([CONFIG, TOKENS])
    const withDark = surface(light, { 'color.background': c('#000000') })
    const restricted = restrictTo(snapshotFromRegister(plain), withDark.coverage)
    expect(restricted.coverage.contexts).toBeUndefined()
    expect(diffSnapshots(restricted, withDark)).toEqual([])
  })

  it('tells per context who changed what since the last sync', () => {
    const at = new Date('2026-10-26T10:00:00Z')
    const base = surface(light, { 'color.background': c('#0a0a0a'), 'color.foreground': c('#fafafa') })
    const lock = parseLock(serializeLock(withLockedSnapshot(parseLock(undefined), 'figma', base, at)))
    const locked = lockedSnapshot(lock, 'figma')
    expect(locked?.contexts?.get('theme=dark')?.size).toBe(2)

    // The surface changed its dark background: a proposal (origin surface).
    const changed = surface(light, { 'color.background': c('#111111'), 'color.foreground': c('#fafafa') })
    const items = threeWayDiff({
      base: locked,
      register: restrictTo(snapshotFromRegister(register), changed.coverage),
      surface: changed,
    })
    expect(items.map((i) => [i.op.path, i.origin])).toEqual([['tokens.color.background', 'surface']])

    // The register changed its dark foreground: the surface has to follow (origin register).
    const edited = buildRegister([
      CONFIG,
      TOKENS,
      resolver(THEME()),
      dark({ color: { background: color('#0a0a0a'), foreground: color('#eeeeee') } }),
    ])
    const behind = threeWayDiff({
      base: locked,
      register: restrictTo(snapshotFromRegister(edited), base.coverage),
      surface: base,
    })
    expect(behind.map((i) => [i.op.path, i.origin])).toEqual([['tokens.color.foreground', 'register']])

    // Both changed the dark foreground differently: a conflict.
    const both = threeWayDiff({
      base: locked,
      register: restrictTo(snapshotFromRegister(edited), base.coverage),
      surface: surface(light, { 'color.background': c('#0a0a0a'), 'color.foreground': c('#dddddd') }),
    })
    expect(both.map((i) => [i.op.path, i.origin])).toEqual([['tokens.color.foreground', 'conflict']])

    // A lock written before modes existed has no dark values: the direction is unknown.
    const old = surface(light)
    const unknown = threeWayDiff({
      base: old,
      register: restrictTo(snapshotFromRegister(register), changed.coverage),
      surface: changed,
    })
    expect(unknown.map((i) => [i.op.path, i.origin])).toEqual([['tokens.color.background', 'unknown']])
  })

  it('keeps edits of the default context free of context changes', () => {
    const files = [CONFIG, TOKENS, resolver(THEME()), DARK]
    const result = applyTokenEdits(files, buildRegister(files), [
      { kind: 'set', path: 'color.brand', value: cssToColor('#487a98') },
    ])
    expect(describeOps(result.ops)).toEqual(['tokens.color.brand #3c6681→#487a98'])
    expect(result.register.modes).toBeDefined()
  })
})

describe('edits per context', () => {
  const files = [CONFIG, TOKENS, resolver(THEME()), DARK]
  const register = buildRegister(files)
  const edit = (edits: Parameters<typeof applyTokenEdits>[2], input = files) =>
    applyTokenEdits(input, buildRegister(input), edits)

  it('changes a dark value in the dark file and reports it with its context', () => {
    const result = edit([
      { kind: 'set', path: 'color.background', value: cssToColor('#111111'), context: 'dark' },
    ])
    expect(result.files.map((f) => f.path)).toEqual(['modes/theme/dark.tokens.json'])
    expect(describeOps(result.ops)).toEqual(['tokens.color.background@theme=dark #0a0a0a→#111111'])
    expect(hex(registerInContext(result.register, 'dark'), 'color.background')).toBe('#111111')
    expect(hex(result.register, 'color.background')).toBe('#ffffff')
  })

  it('gives a token its first own dark value', () => {
    const result = edit([{ kind: 'set', path: 'color.brand', value: cssToColor('#9fc0d6'), context: 'dark' }])
    expect(describeOps(result.ops)).toEqual([
      'tokens.color.brand@theme=dark #3c6681→#9fc0d6 (before falls back)',
    ])
    expect(setsInContext(result.register, 'dark', 'color.brand')).toBe(true)
  })

  it('creates the file of a context that has none yet and adds it to resolver.json', () => {
    const input = [
      CONFIG,
      TOKENS,
      DARK,
      resolver(THEME({ light: [], dark: [{ $ref: 'modes/theme/dark.tokens.json' }], 'high-contrast': [] })),
    ]
    const result = edit(
      [{ kind: 'set', path: 'color.foreground', value: cssToColor('#000000'), context: 'high-contrast' }],
      input,
    )
    expect(result.files.map((f) => f.path).sort()).toEqual([
      'modes/theme/high-contrast.tokens.json',
      'resolver.json',
    ])
    const doc = JSON.parse(result.files.find((f) => f.path === 'resolver.json')?.content ?? '')
    expect(doc.modifiers.theme.contexts['high-contrast']).toEqual([
      { $ref: 'modes/theme/high-contrast.tokens.json' },
    ])
    expect(result.register.issues).toEqual([])
    expect(hex(registerInContext(result.register, 'high-contrast'), 'color.text')).toBe('#000000')
  })

  it('removes an own dark value (it falls back), as a deletion', () => {
    const result = edit([{ kind: 'unset', path: 'color.foreground', context: 'dark' }])
    expect(describeOps(result.ops)).toEqual([
      'tokens.color.foreground@theme=dark #fafafa→#0a0a0a (after falls back)',
    ])
    expect(classify(result.ops[0] as ChangeOp).deletion).toBe(true)
    expect(() => edit([{ kind: 'unset', path: 'color.brand', context: 'dark' }])).toThrow(
      /no dark value of its own/,
    )
    expect(() =>
      edit([{ kind: 'set', path: 'color.brand', value: cssToColor('#000'), context: 'dim' }]),
    ).toThrow(/no context dim/)
  })

  it("takes a token's dark value along when the token is removed", () => {
    const result = edit([{ kind: 'remove', path: 'color.background' }])
    expect(result.register.issues).toEqual([])
    expect(result.files.map((f) => f.path).sort()).toEqual([
      'modes/theme/dark.tokens.json',
      'tokens/color.tokens.json',
    ])
    expect(register.modes?.own.get('dark')?.has('color.background')).toBe(true)
    expect(result.register.modes?.own.get('dark')?.has('color.background')).toBe(false)
  })
})
