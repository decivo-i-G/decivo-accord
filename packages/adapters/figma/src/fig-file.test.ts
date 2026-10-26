import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canvas, FIG_SCHEMA, zip } from '../test/kiwi.js'
import { readFigDocument } from './fig-file.js'
import { figmaDefaultView, parseFigFile } from './figma.js'

const fixtures = fileURLToPath(new URL('../test/fixtures/fig', import.meta.url))
const id = (localID: number) => ({ sessionID: 1, localID })
const value = (v: Record<string, unknown>) => ({ value: v })

// Primitives (one mode) and a themed collection whose default is listed second but sorts first.
const NODES = [
  { guid: id(1), type: 'DOCUMENT', name: 'Document' },
  {
    guid: id(10),
    type: 'VARIABLE_SET',
    name: 'Primitives',
    variableSetModes: [{ id: id(100), name: 'Value', sortPosition: '!' }],
  },
  {
    guid: id(11),
    type: 'VARIABLE_SET',
    name: 'Theme',
    variableSetModes: [
      { id: id(111), name: 'Dark', sortPosition: '"' },
      { id: id(110), name: 'Light', sortPosition: '!' },
    ],
  },
  {
    guid: id(20),
    type: 'VARIABLE',
    name: 'Blue/600',
    variableSetID: { guid: id(10) },
    variableResolvedType: 'COLOR',
    variableDataValues: {
      entries: [{ modeID: id(100), variableData: value({ colorValue: { r: 0, g: 0.4, b: 0.8, a: 1 } }) }],
    },
  },
  {
    guid: id(21),
    type: 'VARIABLE',
    name: 'Radius/MD',
    variableSetID: { guid: id(10) },
    variableResolvedType: 'FLOAT',
    variableScopes: ['CORNER_RADIUS'],
    codeSyntax: { entries: [{ platform: 'WEB', value: 'var(--radius-md)' }] },
    variableDataValues: { entries: [{ modeID: id(100), variableData: value({ floatValue: 8 }) }] },
  },
  {
    guid: id(22),
    type: 'VARIABLE',
    name: 'Color/Brand',
    variableSetID: { guid: id(11) },
    variableResolvedType: 'COLOR',
    variableDataValues: {
      entries: [
        { modeID: id(110), variableData: value({ alias: { guid: id(20) } }) },
        { modeID: id(111), variableData: value({ colorValue: { r: 1, g: 1, b: 1, a: 1 } }) },
      ],
    },
  },
  {
    guid: id(23),
    type: 'VARIABLE',
    name: 'Old',
    isSoftDeleted: true,
    variableSetID: { guid: id(10) },
    variableResolvedType: 'FLOAT',
    variableDataValues: { entries: [{ modeID: id(100), variableData: value({ floatValue: 1 }) }] },
  },
]

const figFile = () =>
  zip({ 'canvas.fig': canvas(FIG_SCHEMA, { nodeChanges: NODES }), 'meta.json': new Uint8Array() })

describe('.fig files', () => {
  it('reads variables, modes in Figma order, aliases, scopes and code syntax', () => {
    const e = parseFigFile(figFile(), 'design/system.fig')
    expect(e.errors).toEqual([])
    expect(e.format).toBe('fig')
    expect(e.variables.map((v) => [v.name, v.mode, v.value, v.collection])).toEqual([
      ['Blue.600', undefined, '#0066cc', 'Primitives'],
      ['Radius.MD', undefined, 8, 'Primitives'],
      ['Color.Brand', 'Light', '#0066cc', 'Theme'],
      ['Color.Brand', 'Dark', '#ffffff', 'Theme'],
    ])
    expect(e.variables[1]).toMatchObject({
      scopes: ['CORNER_RADIUS'],
      cssVariable: '--radius-md',
      type: 'float',
    })
    expect(e.variables[2]?.alias).toBe('Blue.600')
    expect(figmaDefaultView([e]).defaultModes.get('Theme')).toBe('Light')
  })

  it('also reads a bare canvas without the ZIP around it', () => {
    const e = parseFigFile(canvas(FIG_SCHEMA, { nodeChanges: NODES }), 'canvas.fig')
    expect(e.variables).toHaveLength(4)
  })

  it('decodes a real Figma file (zstd generation) and says when it has no variables', async () => {
    const bytes = await readFile(`${fixtures}/corners.fig`)
    const doc = readFigDocument(bytes)
    expect(Array.isArray(doc.nodeChanges)).toBe(true)
    expect(parseFigFile(bytes, 'corners.fig').errors).toEqual([
      'corners.fig: no variables in this Figma file',
    ])
  })

  it('never throws on broken or foreign bytes', async () => {
    const good = figFile()
    const real = await readFile(`${fixtures}/corners.fig`)
    const cases: Uint8Array[] = [
      new Uint8Array(),
      new TextEncoder().encode('{"not":"a fig"}'),
      good.subarray(0, good.length / 2),
      real.subarray(0, 4000),
      canvas(FIG_SCHEMA, { nodeChanges: NODES }).subarray(0, 40),
    ]
    // Flip bytes across a real file: every variant must end in a readable error or a result, never a crash.
    for (let i = 200; i < real.length; i += 997) {
      const copy = Uint8Array.from(real)
      copy[i] = (copy[i] as number) ^ 0xff
      cases.push(copy)
    }
    for (const bytes of cases) {
      const e = parseFigFile(bytes, 'x.fig')
      expect(Array.isArray(e.errors)).toBe(true)
    }
    expect(parseFigFile(new Uint8Array(), 'x.fig').errors[0]).toMatch(/^x\.fig: /)
  })
})
