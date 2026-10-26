import {
  buildRegister,
  type ColorValue,
  colorToHex,
  cssToColor,
  emptyLock,
  type RegisterFile,
  withLockedSnapshot,
} from '@decivo/accord-core'
import { describe, expect, it } from 'vitest'
import { figmaStatus, parseFigmaExport } from './figma.js'

const rgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
  return { r, g, b, a: 1 }
}

/** Figma's REST response with a Light/Dark theme collection and a Rounded/Pill collection. */
function rest(dark: { background: string; text: string }) {
  return JSON.stringify({
    meta: {
      variableCollections: {
        t: {
          id: 't',
          name: 'Theme',
          defaultModeId: 'l',
          modes: [
            { modeId: 'l', name: 'Light' },
            { modeId: 'd', name: 'Dark' },
          ],
        },
        r: {
          id: 'r',
          name: 'Shape',
          defaultModeId: 'a',
          modes: [
            { modeId: 'a', name: 'Rounded' },
            { modeId: 'b', name: 'Pill' },
          ],
        },
      },
      variables: {
        bg: {
          id: 'bg',
          name: 'Color/Background',
          resolvedType: 'COLOR',
          variableCollectionId: 't',
          valuesByMode: { l: rgb('#ffffff'), d: rgb(dark.background) },
        },
        text: {
          id: 'text',
          name: 'Color/Text',
          resolvedType: 'COLOR',
          variableCollectionId: 't',
          valuesByMode: { l: rgb('#171717'), d: rgb(dark.text) },
        },
        radius: {
          id: 'radius',
          name: 'Radius/Card',
          resolvedType: 'FLOAT',
          variableCollectionId: 'r',
          scopes: ['CORNER_RADIUS'],
          valuesByMode: { a: 8, b: 999 },
        },
      },
    },
  })
}

const color = (hex: string) => ({ $value: cssToColor(hex) })
const files = (withModes: boolean): RegisterFile[] => [
  { path: 'accord.config.yaml', content: 'version: 1\n' },
  {
    path: 'tokens/color.tokens.json',
    content: JSON.stringify({
      color: { $type: 'color', background: color('#ffffff'), text: color('#171717') },
      radius: { $type: 'dimension', card: { $value: { value: 8, unit: 'px' } } },
    }),
  },
  ...(withModes
    ? [
        {
          path: 'modes/theme/dark.tokens.json',
          content: JSON.stringify({ color: { background: color('#0a0a0a'), text: color('#fafafa') } }),
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
    : []),
]

describe('Figma modes as register contexts', () => {
  const register = buildRegister(files(true))
  const status = (dark: { background: string; text: string }, lock = emptyLock()) =>
    figmaStatus([parseFigmaExport(rest(dark), 'figma/variables.json')], register, lock)

  it('compares the Dark mode with the dark context; Pill is no context and stays a theme value', () => {
    const inSync = status({ background: '#0a0a0a', text: '#fafafa' })
    expect(register.issues).toEqual([])
    expect(inSync.contexts).toEqual(['dark'])
    expect(inSync.items).toEqual([])
    expect(inSync.snapshot.coverage.contexts).toEqual(['theme=dark'])
    // The Pill value is still reported as a theme value the register does not compare.
    expect(inSync.themed.find((t) => t.path === 'radius.card')?.themed).toEqual([
      { theme: { mode: 'Pill' }, value: 999 },
    ])
  })

  it('finds a dark value changed in Figma, and knows it came from Figma', () => {
    const base = status({ background: '#0a0a0a', text: '#fafafa' })
    const lock = withLockedSnapshot(emptyLock(), 'figma', base.snapshot, new Date('2026-10-26T10:00:00Z'))
    const changed = status({ background: '#111827', text: '#fafafa' }, lock)
    expect(
      changed.items.map((i) => [
        i.op.path,
        i.op.kind === 'token.value_changed' ? i.op.context : undefined,
        i.op.kind === 'token.value_changed' ? colorToHex(i.op.after as ColorValue) : undefined,
        i.origin,
      ]),
    ).toEqual([['tokens.color.background', { theme: 'dark' }, '#111827', 'surface']])
  })

  it('treats a dark value that equals light again as the dark value deleted in Figma', () => {
    const removed = status({ background: '#ffffff', text: '#fafafa' })
    expect(removed.items).toEqual([
      expect.objectContaining({
        op: expect.objectContaining({
          path: 'tokens.color.background',
          context: { theme: 'dark' },
          fallback: 'after',
        }),
        classification: expect.objectContaining({ deletion: true }),
      }),
    ])
  })

  it('compares no mode against a register without modes, as before', () => {
    const plain = figmaStatus(
      [parseFigmaExport(rest({ background: '#123456', text: '#fafafa' }), 'figma/variables.json')],
      buildRegister(files(false)),
      emptyLock(),
    )
    expect(plain.contexts).toEqual([])
    expect(plain.items).toEqual([])
    expect(plain.themed.map((t) => t.path)).toEqual(['color.background', 'color.text', 'radius.card'])
  })
})
