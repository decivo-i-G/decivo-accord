import { describe, expect, it } from 'vitest'
import { applyTokenEdits, EditError, type EditResult } from './edit.js'
import { buildRegister, type RegisterFile } from './register.js'

const hex = (h: string) => ({ colorSpace: 'srgb', components: [0.2353, 0.4, 0.5059], hex: h })

const config: RegisterFile = { path: 'accord.config.yaml', content: 'version: 1\n' }
const color: RegisterFile = {
  path: 'tokens/color.tokens.json',
  content: `${JSON.stringify(
    {
      color: {
        $type: 'color',
        brand: {
          $root: { $value: hex('#487a98'), $description: 'Markenfarbe' },
          '700': {
            $value: hex('#3c6681'),
            $extensions: {
              'de.decivo.accord': { ids: { css: '--brand-700' } },
              'com.example': { keep: true },
            },
          },
        },
        primary: { $value: '{color.brand.700}' },
      },
    },
    null,
    2,
  )}\n`,
}
const spacing: RegisterFile = {
  path: 'tokens/spacing.tokens.json',
  content: `${JSON.stringify({ spacing: { $type: 'dimension', sm: { $value: { value: 8, unit: 'px' } } } }, null, 2)}\n`,
}
const files = [config, color, spacing]
const register = buildRegister(files)
const first = (result: EditResult) => result.files[0]?.content ?? ''

describe('applyTokenEdits', () => {
  it('changes only the edited value and keeps descriptions and unknown extensions', () => {
    const result = applyTokenEdits(files, register, [
      { kind: 'set', path: 'color.brand.700', value: hex('#4a7b9a') },
    ])
    expect(result.files.map((f) => f.path)).toEqual(['tokens/color.tokens.json'])
    const doc = JSON.parse(first(result))
    expect(doc.color.brand['700'].$value.hex).toBe('#4a7b9a')
    expect(doc.color.brand['700'].$extensions['com.example']).toEqual({ keep: true })
    expect(doc.color.brand.$root.$description).toBe('Markenfarbe')
    expect(result.register.tokens.get('color.primary')?.value).toMatchObject({ hex: '#4a7b9a' })
  })

  it('touches no other line of the file', () => {
    const result = applyTokenEdits(files, register, [
      { kind: 'set', path: 'color.brand.700', value: hex('#4a7b9a') },
    ])
    const before = color.content.split('\n')
    const after = first(result).split('\n')
    expect(after).toHaveLength(before.length)
    expect(after.filter((line, i) => line !== before[i])).toEqual(['          "hex": "#4a7b9a"'])
  })

  it('reports the change as a diff operation', () => {
    const { ops } = applyTokenEdits(files, register, [
      { kind: 'set', path: 'color.brand.700', value: hex('#4a7b9a') },
    ])
    expect(ops.map((o) => `${o.kind} ${o.path}`)).toEqual([
      'token.value_changed tokens.color.brand.700',
      'token.value_changed tokens.color.primary',
    ])
  })

  it('adds a token to the file of its group, without a $type the group already gives', () => {
    const result = applyTokenEdits(files, register, [
      {
        kind: 'add',
        path: 'color.brand.600',
        type: 'color',
        value: hex('#4a7d9b'),
        description: 'aus Handoff',
      },
    ])
    const doc = JSON.parse(first(result))
    expect(doc.color.brand['600']).toEqual({ $value: hex('#4a7d9b'), $description: 'aus Handoff' })
    expect(result.ops).toEqual([
      expect.objectContaining({ kind: 'token.added', path: 'tokens.color.brand.600' }),
    ])
  })

  it('adds new groups as needed', () => {
    const result = applyTokenEdits(files, register, [
      { kind: 'add', path: 'color.accent.500', type: 'color', value: hex('#aa3300') },
    ])
    expect(JSON.parse(first(result)).color.accent).toEqual({ '500': { $value: hex('#aa3300') } })
  })

  it('edits several files at once and leaves untouched files out', () => {
    const result = applyTokenEdits(files, register, [
      { kind: 'set', path: 'spacing.sm', value: { value: 12, unit: 'px' } },
      { kind: 'set', path: 'color.brand.$root', value: hex('#4a7b9a') },
    ])
    expect(result.files.map((f) => f.path).sort()).toEqual([
      'tokens/color.tokens.json',
      'tokens/spacing.tokens.json',
    ])
  })

  it('returns no files when the value is the same', () => {
    const result = applyTokenEdits(files, register, [
      { kind: 'set', path: 'color.brand.700', value: hex('#3c6681') },
    ])
    expect(result.files).toEqual([])
    expect(result.ops).toEqual([])
  })

  it.each([
    [{ kind: 'set', path: 'color.brand.900', value: hex('#000000') }, /does not exist/],
    [{ kind: 'set', path: 'color.primary', value: hex('#000000') }, /alias of color.brand.700/],
    [{ kind: 'set', path: 'spacing.sm', value: '8px' }, /invalid value for spacing.sm/],
    [{ kind: 'add', path: 'color.brand.700', type: 'color', value: hex('#000000') }, /already exists/],
    [{ kind: 'add', path: 'color.brand', type: 'color', value: hex('#000000') }, /already exists/],
    [
      { kind: 'add', path: 'color.brand.700.x', type: 'color', value: hex('#000000') },
      /inside the token 700/,
    ],
    [
      { kind: 'add', path: 'motion.fast', type: 'duration', value: { value: 100, unit: 'ms' } },
      /no token file/,
    ],
  ] as const)('refuses %o', (edit, message) => {
    expect(() => applyTokenEdits(files, register, [edit])).toThrow(message)
    expect(() => applyTokenEdits(files, register, [edit])).toThrow(EditError)
  })

  it('adds a token in a new top-level group when a file is named', () => {
    const result = applyTokenEdits(files, register, [
      {
        kind: 'add',
        path: 'motion.fast',
        type: 'duration',
        value: { value: 100, unit: 'ms' },
        file: 'tokens/spacing.tokens.json',
      },
    ])
    expect(JSON.parse(first(result)).motion).toEqual({
      fast: { $type: 'duration', $value: { value: 100, unit: 'ms' } },
    })
  })

  it('never changes the input files', () => {
    const copy = files.map((f) => ({ ...f }))
    applyTokenEdits(files, register, [{ kind: 'set', path: 'color.brand.700', value: hex('#4a7b9a') }])
    expect(files).toEqual(copy)
  })

  it('removes a token and the groups it leaves empty, and reports the removal', () => {
    const result = applyTokenEdits(files, register, [{ kind: 'remove', path: 'spacing.sm' }])
    expect(JSON.parse(first(result))).toEqual({})
    expect(result.register.tokens.has('spacing.sm')).toBe(false)
    expect(result.ops.map((o) => [o.kind, o.path])).toEqual([['token.removed', 'tokens.spacing.sm']])
    const alias = applyTokenEdits(files, register, [{ kind: 'remove', path: 'color.primary' }])
    expect(JSON.parse(first(alias)).color.brand['700'].$value.hex).toBe('#3c6681')
    expect(JSON.parse(first(alias)).color.primary).toBeUndefined()
  })

  it('refuses to remove a token other tokens still point to', () => {
    expect(() => applyTokenEdits(files, register, [{ kind: 'remove', path: 'color.brand.700' }])).toThrow(
      'color.primary still point to color.brand.700',
    )
    expect(() => applyTokenEdits(files, register, [{ kind: 'remove', path: 'color.nope' }])).toThrow(
      EditError,
    )
  })
})
