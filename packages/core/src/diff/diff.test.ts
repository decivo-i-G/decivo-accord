import { describe, expect, it } from 'vitest'
import { cssToColor } from '../dtcg/color.js'
import { emptyLock, lockedSnapshot, parseLock, serializeLock, withLockedSnapshot } from '../lock.js'
import { type ChangeOp, classify, diffSnapshots } from './diff.js'
import {
  type Coverage,
  FULL_COVERAGE,
  formatValue,
  type Snapshot,
  type SnapshotComponent,
  type SnapshotToken,
  valuesEqual,
} from './snapshot.js'
import { threeWayDiff } from './three-way.js'

const color = (hex: string): SnapshotToken => ({ type: 'color', value: cssToColor(hex) })
const px = (value: number, unit: 'px' | 'rem' = 'px'): SnapshotToken => ({
  type: 'dimension',
  value: { value, unit },
})

const button = (over: Partial<SnapshotComponent> = {}): SnapshotComponent => ({
  variants: { variant: ['primary', 'secondary', 'ghost'] },
  props: { disabled: { type: 'boolean', required: false, default: false } },
  states: ['default', 'hover', 'disabled'],
  slots: { label: 'required', icon: 'optional' },
  ...over,
})

const snap = (
  tokens: Record<string, SnapshotToken>,
  components: Record<string, SnapshotComponent> = {},
  coverage: Coverage = FULL_COVERAGE,
): Snapshot => ({
  tokens: new Map(Object.entries(tokens)),
  components: new Map(Object.entries(components)),
  coverage,
})

const REGISTER = {
  'color.brand.600': color('#487a98'),
  'color.brand.700': color('#3c6681'),
  'spacing.lg': px(24),
}

const kinds = (ops: ChangeOp[]) => ops.map((o) => `${o.kind} ${o.path}`)

describe('valuesEqual', () => {
  it('compares colours by hex and alpha, not by representation', () => {
    const a = cssToColor('#3c6681')
    const b = { colorSpace: 'hsl', components: [203.4, 36.6, 37.1] }
    expect(valuesEqual('color', a, b)).toBe(true)
    expect(valuesEqual('color', a, cssToColor('#3c668180'))).toBe(false)
  })

  it('compares dimensions in pixels', () => {
    expect(valuesEqual('dimension', { value: 16, unit: 'px' }, { value: 1, unit: 'rem' })).toBe(true)
    expect(valuesEqual('dimension', { value: 24, unit: 'px' }, { value: 28, unit: 'px' })).toBe(false)
  })

  it('applies the same rules inside composite values', () => {
    const shadow = (hex: string) => ({
      color: cssToColor(hex),
      offsetX: { value: 0, unit: 'px' },
      offsetY: { value: 1, unit: 'rem' },
    })
    expect(
      valuesEqual('shadow', [shadow('#000')], [{ ...shadow('#000000'), offsetY: { value: 16, unit: 'px' } }]),
    ).toBe(true)
  })

  it('formats values for people', () => {
    expect(formatValue('color', cssToColor('#3C6681'))).toBe('#3c6681')
    expect(formatValue('color', cssToColor('rgba(0,0,0,.32)'))).toBe('#000000 / 32%')
    expect(formatValue('dimension', { value: 24, unit: 'px' })).toBe('24px')
  })
})

describe('diffSnapshots', () => {
  it('finds changed, added and removed tokens', () => {
    const ops = diffSnapshots(
      snap(REGISTER),
      snap({ 'color.brand.600': color('#4a7d9b'), 'color.brand.700': color('#3c6681'), 'radius.md': px(8) }),
    )
    expect(kinds(ops)).toEqual([
      'token.value_changed tokens.color.brand.600',
      'token.removed tokens.spacing.lg',
      'token.added tokens.radius.md',
    ])
  })

  it('reports a unique same-value pair as a rename', () => {
    const renamed = diffSnapshots(
      snap(REGISTER),
      snap({ 'color.brand.600': color('#487a98'), 'color.brand.700': color('#3c6681'), 'space.lg': px(24) }),
    )
    expect(renamed).toEqual([
      { kind: 'token.renamed', path: 'tokens.spacing.lg', to: 'tokens.space.lg', token: px(24) },
    ])
  })

  it('does not guess a rename when two candidates share the value', () => {
    const ops = diffSnapshots(snap({ a: px(8) }), snap({ b: px(8), c: px(8) }))
    expect(kinds(ops)).toEqual(['token.removed tokens.a', 'token.added tokens.b', 'token.added tokens.c'])
  })

  it('ignores what the other side does not cover', () => {
    const colorsOnly: Coverage = { tokens: ['color.**'], components: ['variants'] }
    const ops = diffSnapshots(
      snap(REGISTER, { Button: button() }),
      snap(
        { 'color.brand.600': color('#487a98') },
        { Button: button({ props: {}, states: [] }) },
        colorsOnly,
      ),
    )
    expect(kinds(ops)).toEqual(['token.removed tokens.color.brand.700'])
  })

  it('diffs components field by field', () => {
    const after = button({
      variants: { variant: ['primary', 'ghost', 'link'], size: ['sm', 'md'] },
      props: {
        disabled: { type: 'boolean', required: true, default: false },
        asChild: { type: 'boolean', required: false },
      },
      states: ['default', 'hover', 'focus-visible'],
      slots: { label: 'required', icon: 'required' },
    })
    expect(kinds(diffSnapshots(snap({}, { Button: button() }), snap({}, { Button: after })))).toEqual([
      'variant.removed components.Button.variants.variant',
      'variant.added components.Button.variants.variant',
      'variant_axis.added components.Button.variants.size',
      'prop.changed components.Button.props.disabled',
      'prop.added components.Button.props.asChild',
      'state.removed components.Button.states.disabled',
      'state.added components.Button.states.focus-visible',
      'slot.changed components.Button.slots.icon',
    ])
  })
})

describe('classify', () => {
  const op = (o: ChangeOp) => classify(o)
  it.each<[string, ChangeOp, boolean, boolean]>([
    ['token removed', { kind: 'token.removed', path: 'tokens.a', before: px(1) }, true, true],
    ['token renamed', { kind: 'token.renamed', path: 'tokens.a', to: 'tokens.b', token: px(1) }, true, false],
    [
      'token type changed',
      { kind: 'token.type_changed', path: 'tokens.a', before: 'dimension', after: 'number' },
      true,
      false,
    ],
    [
      'token value changed',
      { kind: 'token.value_changed', path: 'tokens.a', type: 'dimension', before: 1, after: 2 },
      false,
      false,
    ],
    ['token added', { kind: 'token.added', path: 'tokens.a', after: px(1) }, false, false],
    [
      'variant removed',
      { kind: 'variant.removed', path: 'components.B.variants.v', option: 'ghost' },
      true,
      true,
    ],
    [
      'variant added',
      { kind: 'variant.added', path: 'components.B.variants.v', option: 'link' },
      false,
      false,
    ],
    [
      'required prop added',
      { kind: 'prop.added', path: 'components.B.props.x', after: { type: 'string', required: true } },
      true,
      false,
    ],
    [
      'optional prop added',
      { kind: 'prop.added', path: 'components.B.props.x', after: { type: 'string', required: false } },
      false,
      false,
    ],
    [
      'prop became required',
      { kind: 'prop.changed', path: 'components.B.props.x', field: 'required', before: false, after: true },
      true,
      false,
    ],
    [
      'enum value removed',
      {
        kind: 'prop.changed',
        path: 'components.B.props.x',
        field: 'values',
        before: ['a', 'b'],
        after: ['a'],
      },
      true,
      false,
    ],
    [
      'enum value added',
      {
        kind: 'prop.changed',
        path: 'components.B.props.x',
        field: 'values',
        before: ['a'],
        after: ['a', 'b'],
      },
      false,
      false,
    ],
    ['component removed', { kind: 'component.removed', path: 'components.B', before: button() }, true, true],
  ])('%s → breaking %s, deletion %s', (_name, change, breaking, deletion) => {
    expect(op(change)).toMatchObject({ breaking, deletion })
  })

  it('maps renames and additions to register-owned aspects', () => {
    expect(classify({ kind: 'token.renamed', path: 'tokens.a', to: 'tokens.b', token: px(1) }).aspect).toBe(
      'name',
    )
    expect(classify({ kind: 'token.added', path: 'tokens.a', after: px(1) }).aspect).toBe('existence')
    expect(
      classify({ kind: 'token.value_changed', path: 'tokens.a', type: 'dimension', before: 1, after: 2 })
        .aspect,
    ).toBe('value')
  })
})

describe('threeWayDiff', () => {
  const claudeDesign: Coverage = { tokens: ['color.**', 'spacing.**'], components: ['variants'] }
  const base = snap(REGISTER, {}, claudeDesign)

  it('marks a value changed only in Claude Design as coming from the surface', () => {
    const surface = snap({ ...REGISTER, 'spacing.lg': px(28) }, {}, claudeDesign)
    expect(threeWayDiff({ base, register: snap(REGISTER), surface })).toMatchObject([
      {
        origin: 'surface',
        op: { kind: 'token.value_changed', path: 'tokens.spacing.lg' },
        classification: { breaking: false },
      },
    ])
  })

  it('marks a register change the surface has not received yet as a projection', () => {
    const register = snap({ ...REGISTER, 'spacing.lg': px(20) })
    expect(threeWayDiff({ base, register, surface: base })).toMatchObject([{ origin: 'register' }])
  })

  it('marks a token the register deleted as a projection, not a proposal to re-add it', () => {
    const { 'spacing.lg': _gone, ...rest } = REGISTER
    expect(threeWayDiff({ base, register: snap(rest), surface: base })).toMatchObject([
      { origin: 'register', op: { kind: 'token.added', path: 'tokens.spacing.lg' } },
    ])
  })

  it('reports a conflict when both sides changed the same value differently', () => {
    const register = snap({ ...REGISTER, 'spacing.lg': px(20) })
    const surface = snap({ ...REGISTER, 'spacing.lg': px(28) }, {}, claudeDesign)
    expect(threeWayDiff({ base, register, surface })).toMatchObject([{ origin: 'conflict' }])
  })

  it('keeps value and deprecation changes on the same token apart', () => {
    const register = snap({ ...REGISTER, 'spacing.lg': { ...px(24), deprecated: 'Use spacing.xl' } })
    const surface = snap({ ...REGISTER, 'spacing.lg': px(28) }, {}, claudeDesign)
    expect(threeWayDiff({ base, register, surface }).map((d) => [d.op.kind, d.origin])).toEqual([
      ['token.value_changed', 'surface'],
      ['token.deprecated_changed', 'register'],
    ])
  })

  it('cannot tell the direction without a lock entry', () => {
    const surface = snap({ ...REGISTER, 'color.brand.600': color('#4a7d9b') }, {}, claudeDesign)
    expect(threeWayDiff({ register: snap(REGISTER), surface })).toMatchObject([{ origin: 'unknown' }])
  })

  it('reports nothing when surface and register agree', () => {
    expect(
      threeWayDiff({ base, register: snap(REGISTER), surface: snap(REGISTER, {}, claudeDesign) }),
    ).toEqual([])
  })
})

describe('surfaces.lock.json', () => {
  it('round-trips snapshots', () => {
    const surface = snap(REGISTER, { Button: button() }, { tokens: ['color.**'], components: ['variants'] })
    const lock = withLockedSnapshot(
      emptyLock(),
      'claude-design',
      surface,
      new Date('2026-10-11T10:00:00Z'),
      'abc123',
    )
    const parsed = parseLock(serializeLock(lock))
    expect(parsed.surfaces['claude-design']).toMatchObject({
      synced_at: '2026-10-11T10:00:00.000Z',
      register_ref: 'abc123',
    })
    const back = lockedSnapshot(parsed, 'claude-design')
    expect(back && diffSnapshots(surface, back)).toEqual([])
    expect(lockedSnapshot(parsed, 'figma')).toBeUndefined()
  })

  it('treats a missing lock file as empty', () => {
    expect(parseLock(undefined)).toEqual({ version: 1, surfaces: {} })
  })
})
