import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { buildRegister, emptyLock, type RegisterFile } from '@decivo/accord-core'
import { describe, expect, it } from 'vitest'
import {
  figmaDefaultView,
  figmaStatus,
  groupModeFiles,
  modeFromFileName,
  parseFigmaExport,
  readFigmaExports,
  rgbaToHex,
} from './figma.js'

const fixtures = fileURLToPath(new URL('../test/fixtures', import.meta.url))
const hex = (h: string) => ({ colorSpace: 'srgb', components: [0, 0, 0], hex: h })

const register = buildRegister([
  { path: 'accord.config.yaml', content: 'version: 1\n' },
  {
    path: 'tokens/color.tokens.json',
    content: JSON.stringify({
      color: {
        $type: 'color',
        brand: { $root: { $value: hex('#487a98') } },
        text: { $value: hex('#16222b') },
        border: { $value: hex('#dde3e8') },
      },
      radius: { md: { $type: 'dimension', $value: { value: 8, unit: 'px' } } },
    }),
  } satisfies RegisterFile,
])

describe('Figma variable exports', () => {
  it('reads the mode from file names like colors.Dark.json or dark.tokens.json', () => {
    expect(modeFromFileName('figma/colors.Dark.tokens.json')).toBe('Dark')
    expect(modeFromFileName('dark.tokens.json')).toBe('dark')
    expect(modeFromFileName('figma/colors.json')).toBeUndefined()
    expect(modeFromFileName('figma/primitives.tokens.json')).toBeUndefined()
  })

  it('reads Figma’s DTCG export with typed colours, aliases and numbers', async () => {
    const text = await readFile(`${fixtures}/native/colors.Light.tokens.json`, 'utf8')
    const e = parseFigmaExport(text, 'colors.Light.tokens.json')
    expect(e.format).toBe('dtcg')
    expect(e.errors).toEqual([])
    expect(e.variables.map((v) => [v.name, v.mode])).toEqual([
      ['color.brand', 'Light'],
      ['color.text', 'Light'],
      ['color.on-brand', 'Light'],
      ['radius.md', 'Light'],
    ])
    // The alias is resolved within the same mode.
    expect(e.variables.find((v) => v.name === 'color.on-brand')?.value).toMatchObject({ hex: '#16222B' })
  })

  it('compares the default mode with the register and keeps the dark values', async () => {
    const status = figmaStatus(
      await readFigmaExports(`${fixtures}/native`, ['*.json']),
      register,
      emptyLock(),
    )
    expect(status.modes).toEqual(['Dark', 'Light'])
    expect(status.defaultMode).toBe('Light')
    // color.brand matches color.brand.$root; the drift is #487a98 → #4a7b9a.
    expect(status.items.map((i) => `${i.op.kind} ${i.op.path}`)).toEqual([
      'token.value_changed tokens.color.brand.$root',
    ])
    // radius.md is a number in Figma and 8px in the register: equal.
    expect(status.snapshot.tokens.has('radius.md')).toBe(true)
    expect(status.themed.map((t) => t.path)).toEqual(['color.text'])
    expect(status.unmapped.map((v) => v.name)).toEqual(['color.on-brand'])
    expect(status.missing).toEqual(['color.border'])
  })

  it('reads Tokens Studio files with mode groups and matches Figma-style names case-insensitively', async () => {
    const exports = await readFigmaExports(`${fixtures}/plugin`, ['*.json'])
    expect(exports[0]?.format).toBe('tokens-studio')
    const status = figmaStatus(exports, register, emptyLock())
    expect(status.defaultMode).toBe('Light')
    // Color.Brand matches; Color.Border is rgba(0,0,0,.1) in Figma and #dde3e8 in the register: drift.
    expect(status.items.map((i) => i.op.path)).toEqual(['tokens.color.border'])
    expect(status.themed.find((t) => t.path === 'color.brand.$root')?.themed).toEqual([
      { theme: { mode: 'Dark' }, value: '#5b8fb0' },
    ])
  })

  it('a configured default mode wins', async () => {
    const status = figmaStatus(
      await readFigmaExports(`${fixtures}/native`, ['*.json']),
      register,
      emptyLock(),
      {
        defaultMode: 'dark',
      },
    )
    expect(status.defaultMode).toBe('Dark')
    expect(status.items.map((i) => i.op.path).sort()).toEqual([
      'tokens.color.brand.$root',
      'tokens.color.text',
    ])
  })

  it('never throws on broken files', () => {
    expect(parseFigmaExport('{ kaputt', 'x.json').errors).toEqual(['x.json: not a readable JSON export'])
    expect(parseFigmaExport('[1,2]', 'y.json').errors).toHaveLength(1)
    // A reference cycle resolves to nothing instead of looping.
    expect(
      figmaStatus([parseFigmaExport('{"a": {"$value": "{a}"}}', 'loop.json')], register, emptyLock())
        .unmapped[0]?.value,
    ).toBeUndefined()
  })

  it('reads the Figma REST response (variables/local): ids, aliases, modes, single-mode collections', () => {
    const rest = {
      status: 200,
      meta: {
        variableCollections: {
          p: { modes: [{ modeId: 'p1', name: 'Value' }] },
          t: {
            modes: [
              { modeId: 'l', name: 'Light' },
              { modeId: 'd', name: 'Dark' },
            ],
          },
        },
        variables: {
          'v:1': {
            id: 'v:1',
            name: 'Blue/600',
            resolvedType: 'COLOR',
            valuesByMode: { p1: { r: 0.2902, g: 0.4824, b: 0.6039, a: 1 } },
          },
          'v:2': {
            id: 'v:2',
            name: 'Color/Brand',
            resolvedType: 'COLOR',
            valuesByMode: { l: { type: 'VARIABLE_ALIAS', id: 'v:1' }, d: { r: 1, g: 1, b: 1, a: 0.5 } },
          },
          'v:3': {
            id: 'v:3',
            name: 'Remote',
            resolvedType: 'COLOR',
            valuesByMode: { p1: { type: 'VARIABLE_ALIAS', id: 'elsewhere' } },
          },
        },
      },
    }
    const e = parseFigmaExport(JSON.stringify(rest), 'variables.json')
    expect(e.format).toBe('figma-rest')
    expect(e.variables.map((v) => [v.name, v.mode, v.value])).toEqual([
      ['Blue.600', undefined, '#4a7b9a'],
      ['Color.Brand', 'Light', '#4a7b9a'],
      ['Color.Brand', 'Dark', '#ffffff80'],
      ['Remote', undefined, undefined],
    ])
    // "Color.Brand" matches color.brand.$root case-insensitively; Light is compared.
    const status = figmaStatus([e], register, emptyLock())
    expect(status.items.map((i) => i.op.path)).toEqual(['tokens.color.brand.$root'])
  })

  it('reads the variables2json plugin format with alias chains across collections', () => {
    const v2j = {
      version: '1.0.4',
      collections: [
        {
          name: 'primitives',
          modes: [
            {
              name: 'Value',
              variables: [
                { name: 'gray/900', type: 'color', isAlias: false, value: { r: 22, g: 34, b: 43, a: 1 } },
              ],
            },
          ],
        },
        {
          name: 'semantic',
          modes: [
            {
              name: 'Light',
              variables: [
                {
                  name: 'text/strong',
                  type: 'color',
                  isAlias: true,
                  value: { collection: 'primitives', name: 'gray/900' },
                },
              ],
            },
            {
              name: 'Dark',
              variables: [{ name: 'text/strong', type: 'color', isAlias: false, value: '#F5F7F9' }],
            },
          ],
        },
        {
          name: 'aliases',
          modes: [
            {
              name: 'Mode 1',
              variables: [
                {
                  name: 'color/text',
                  type: 'color',
                  isAlias: true,
                  value: { collection: 'semantic', name: 'text/strong' },
                },
              ],
            },
          ],
        },
      ],
    }
    const e = parseFigmaExport(JSON.stringify(v2j), 'variables.json')
    expect(e.format).toBe('variables2json')
    expect(e.variables.find((v) => v.name === 'color.text')?.value).toBe('#16222b')
    expect(figmaStatus([e], register, emptyLock()).items).toEqual([])
  })

  it('resolves references that point into another export file', () => {
    const primitives = parseFigmaExport(
      '{"blue": {"600": {"$type": "color", "$value": "#4a7b9a"}}}',
      'primitives.json',
    )
    const semantic = parseFigmaExport(
      '{"color": {"brand": {"$type": "color", "$value": "{blue.600}"}}}',
      'semantic.json',
    )
    const status = figmaStatus([primitives, semantic], register, emptyLock())
    expect(status.items.map((i) => i.op.path)).toEqual(['tokens.color.brand.$root'])
  })

  it('converts Figma RGBA in both channel scales', () => {
    expect(rgbaToHex({ r: 1, g: 0, b: 0, a: 1 })).toBe('#ff0000')
    expect(rgbaToHex({ r: 255, g: 0, b: 0, a: 0.5 })).toBe('#ff000080')
    expect(rgbaToHex({ r: 'x' })).toBeUndefined()
  })

  it('keeps scopes, code syntax, alias names and the collection default mode from the REST response', () => {
    const rest = {
      meta: {
        variableCollections: {
          'c:1': {
            id: 'c:1',
            name: 'Theme',
            defaultModeId: 'd',
            modes: [
              { modeId: 'l', name: 'Light' },
              { modeId: 'd', name: 'Brand' },
            ],
          },
        },
        variables: {
          'v:1': {
            id: 'v:1',
            name: 'Radius/MD',
            resolvedType: 'FLOAT',
            variableCollectionId: 'c:1',
            scopes: ['CORNER_RADIUS'],
            codeSyntax: { WEB: 'var(--radius-md)' },
            valuesByMode: { l: 8, d: 12 },
          },
          'v:2': {
            id: 'v:2',
            name: 'Radius/Card',
            resolvedType: 'FLOAT',
            variableCollectionId: 'c:1',
            valuesByMode: {
              l: { type: 'VARIABLE_ALIAS', id: 'v:1' },
              d: { type: 'VARIABLE_ALIAS', id: 'v:1' },
            },
          },
        },
      },
    }
    const e = parseFigmaExport(JSON.stringify(rest), 'variables.json')
    const md = e.variables.find((v) => v.name === 'Radius.MD')
    expect(md).toMatchObject({ collection: 'Theme', scopes: ['CORNER_RADIUS'], cssVariable: '--radius-md' })
    expect(e.variables.find((v) => v.name === 'Radius.Card')?.alias).toBe('Radius.MD')
    // The collection's default mode (Brand) comes first and is the one compared.
    const view = figmaDefaultView([e])
    expect(view.defaultModes.get('Theme')).toBe('Brand')
    expect(view.defaults.map((v) => v.value)).toEqual([12, 12])
    expect(figmaDefaultView([e], { defaultMode: 'light' }).defaults.map((v) => v.value)).toEqual([8, 8])
  })

  it('reads aliasData and nested com.figma extensions from Figma’s own DTCG export', () => {
    const doc = {
      'color-headline': {
        $type: 'color',
        $value: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 1, hex: '#000000' },
        $extensions: {
          'com.figma.scopes': ['ALL_SCOPES'],
          'com.figma.aliasData': { targetVariableName: 'products/dark-blue', targetVariableSetName: 'Base' },
        },
      },
      density: {
        pill: {
          $type: 'dimension',
          $value: { value: 9999, unit: 'px' },
          $extensions: { 'com.figma': { scopes: ['CORNER_RADIUS'], codeSyntax: { WEB: 'var(--eds-pill)' } } },
        },
      },
    }
    const e = parseFigmaExport(JSON.stringify(doc), 'Theme.json')
    expect(e.variables[0]?.alias).toBe('products.dark-blue')
    expect(e.variables[1]).toMatchObject({ scopes: ['CORNER_RADIUS'], cssVariable: '--eds-pill' })
  })

  it('reads files that differ only in their last name part as modes of one collection', () => {
    const file = (name: string, value: number) =>
      parseFigmaExport(JSON.stringify({ radius: { $type: 'number', $value: value } }), name)
    const exports = groupModeFiles([
      file('tokens/⭕️ Border radius.Pill.json', 999),
      file('tokens/⭕️ Border radius.None.json', 0),
      file('tokens/Other.json', 1),
    ])
    expect(exports.map((e) => e.variables[0]?.mode)).toEqual(['Pill', 'None', undefined])
    expect(exports[0]?.variables[0]?.collection).toBe('⭕️ Border radius')
    const view = figmaDefaultView(exports)
    // No usual default name: the first mode seen wins, the other one follows with modes.
    expect(view.defaultModes.get('⭕️ Border radius')).toBe('Pill')
    expect(view.others.map((v) => v.mode)).toEqual(['None'])
  })

  it('reads a collection dumped with the Plugin API, falling back to resolved values for outside aliases', () => {
    const dump = {
      id: 'c:1',
      name: 'Primitives',
      modes: { 'm:1': 'Light' },
      variables: [
        {
          id: 'v:1',
          name: 'colors/primary-100',
          type: 'COLOR',
          scopes: ['ALL_SCOPES'],
          valuesByMode: { 'm:1': { r: 1, g: 1, b: 1, a: 1 } },
        },
        {
          id: 'v:2',
          name: 'colors/link',
          type: 'COLOR',
          valuesByMode: { 'm:1': { type: 'VARIABLE_ALIAS', id: 'elsewhere' } },
          resolvedValuesByMode: { 'm:1': { resolvedValue: { r: 0, g: 0, b: 0, a: 1 }, alias: null } },
        },
      ],
    }
    const e = parseFigmaExport(JSON.stringify(dump), 'Primitives.json')
    expect(e.format).toBe('figma-plugin')
    expect(e.variables.map((v) => [v.name, v.mode, v.value, v.collection])).toEqual([
      ['colors.primary-100', undefined, '#ffffff', 'Primitives'],
      ['colors.link', undefined, '#000000', 'Primitives'],
    ])
    expect(parseFigmaExport('[1, 2]', 'list.json').errors).toHaveLength(1)
  })
})
