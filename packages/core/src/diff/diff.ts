import type { TokenType } from '../dtcg/types.js'
import { contextKey, contextLabel, type ModeContext, parseContextKey } from '../modes/resolver.js'
import type { Aspect } from '../ownership.js'
import {
  type ComponentAspect,
  coversToken,
  type Snapshot,
  type SnapshotComponent,
  type SnapshotProp,
  type SnapshotToken,
  sharedContexts,
  valuesEqual,
} from './snapshot.js'

/**
 * One semantic difference: applying it to `from` moves it towards `to`.
 * `path` is a register path (`tokens.color.brand.700`, `components.Button.props.size`).
 *
 * Value changes may carry a `context` (`{ theme: 'dark' }`): the change applies to the token's value in that
 * context only. Without `context` a change is about the default context (or a register without modes).
 * Tokens exist in every context alike, so additions, removals, renames and type changes never carry one.
 */
export type ChangeOp =
  | { kind: 'token.added'; path: string; after: SnapshotToken }
  | { kind: 'token.removed'; path: string; before: SnapshotToken }
  | { kind: 'token.renamed'; path: string; to: string; token: SnapshotToken }
  | {
      kind: 'token.value_changed'
      path: string
      type: TokenType
      before: unknown
      after: unknown
      context?: ModeContext | undefined
      /**
       * In a context, the side that has no value of its own there and falls back to its default:
       * `before`: the context gets its own value; `after`: the context's own value is removed (a deletion).
       */
      fallback?: 'before' | 'after' | undefined
    }
  | { kind: 'token.type_changed'; path: string; before: TokenType; after: TokenType }
  | {
      kind: 'token.alias_changed'
      path: string
      before?: string | undefined
      after?: string | undefined
      context?: ModeContext | undefined
    }
  | {
      kind: 'token.deprecated_changed'
      path: string
      before?: boolean | string | undefined
      after?: boolean | string | undefined
    }
  | { kind: 'component.added'; path: string; after: SnapshotComponent }
  | { kind: 'component.removed'; path: string; before: SnapshotComponent }
  | { kind: 'variant_axis.added'; path: string; options: string[] }
  | { kind: 'variant_axis.removed'; path: string; options: string[] }
  | { kind: 'variant.added'; path: string; option: string }
  | { kind: 'variant.removed'; path: string; option: string }
  | { kind: 'prop.added'; path: string; after: SnapshotProp }
  | { kind: 'prop.removed'; path: string; before: SnapshotProp }
  | {
      kind: 'prop.changed'
      path: string
      field: 'type' | 'required' | 'default' | 'values'
      before: unknown
      after: unknown
    }
  | { kind: 'state.added'; path: string; state: string }
  | { kind: 'state.removed'; path: string; state: string }
  | { kind: 'slot.added'; path: string; after: 'required' | 'optional' }
  | { kind: 'slot.removed'; path: string; before: 'required' | 'optional' }
  | { kind: 'slot.changed'; path: string; before: 'required' | 'optional'; after: 'required' | 'optional' }

export type ChangeKind = ChangeOp['kind']

export interface Classification {
  /** Consumers of the design system can break (removed API, renamed token, changed type …). */
  breaking: boolean
  /** Which part of the entry changes; drives ownership (see `resolveOwner`). */
  aspect: Aspect
  /** Deletions always need a human, independent of `breaking`. */
  deletion: boolean
  reason: string
}

/** Fixed rules, not configuration (principle 4). */
export function classify(op: ChangeOp): Classification {
  const c = (breaking: boolean, aspect: Aspect, reason: string, deletion = false): Classification => ({
    breaking,
    aspect,
    deletion,
    reason,
  })
  switch (op.kind) {
    case 'token.added':
      return c(false, 'existence', 'new token')
    case 'token.removed':
      return c(true, 'existence', 'token removed; every usage breaks', true)
    case 'token.renamed':
      return c(true, 'name', `renamed to ${op.to}; every usage of the old name breaks`)
    case 'token.value_changed':
      if (op.context) {
        const label = contextLabel(op.context)
        // The mode never changes who owns the token: a value per context is a value (aspect `value`).
        // Removing a context's own value is still a deletion, and deletions always need a person.
        if (op.fallback === 'after')
          return c(false, 'value', `own ${label} value removed; falls back to the default value`, true)
        return c(false, 'value', `${label} value changed; usages keep working but look different`)
      }
      return c(false, 'value', 'value changed; usages keep working but look different')
    case 'token.type_changed':
      return c(true, 'value', `type changed from ${op.before} to ${op.after}`)
    case 'token.alias_changed': {
      const where = op.context ? ` in ${contextLabel(op.context)}` : ''
      return c(
        false,
        'value',
        op.after ? `now references ${op.after}${where}` : `no longer a reference${where}`,
      )
    }
    case 'token.deprecated_changed':
      return c(false, 'deprecation', op.after ? 'deprecated' : 'no longer deprecated')
    case 'component.added':
      return c(false, 'existence', 'new component')
    case 'component.removed':
      return c(true, 'existence', 'component removed', true)
    case 'variant_axis.added':
      return c(false, 'value', 'new variant axis')
    case 'variant_axis.removed':
      return c(true, 'value', 'variant axis removed', true)
    case 'variant.added':
      return c(false, 'value', `new variant "${op.option}"`)
    case 'variant.removed':
      return c(true, 'value', `variant "${op.option}" removed`, true)
    case 'prop.added':
      return op.after.required
        ? c(true, 'value', 'new required prop')
        : c(false, 'value', 'new optional prop')
    case 'prop.removed':
      return c(true, 'value', 'prop removed', true)
    case 'prop.changed':
      if (op.field === 'required') {
        return op.after ? c(true, 'value', 'prop became required') : c(false, 'value', 'prop became optional')
      }
      if (op.field === 'values') {
        const before = (op.before as string[] | undefined) ?? []
        const after = (op.after as string[] | undefined) ?? []
        const removed = before.filter((v) => !after.includes(v))
        return removed.length > 0
          ? c(true, 'value', `allowed values removed: ${removed.join(', ')}`)
          : c(false, 'value', 'allowed values added')
      }
      if (op.field === 'type')
        return c(true, 'value', `prop type changed from ${String(op.before)} to ${String(op.after)}`)
      return c(false, 'value', 'default changed')
    case 'state.added':
      return c(false, 'value', `new state "${op.state}"`)
    case 'state.removed':
      return c(true, 'value', `state "${op.state}" removed`, true)
    case 'slot.added':
      return op.after === 'required'
        ? c(true, 'value', 'new required slot')
        : c(false, 'value', 'new optional slot')
    case 'slot.removed':
      return c(true, 'value', 'slot removed', true)
    case 'slot.changed':
      return op.after === 'required'
        ? c(true, 'value', 'slot became required')
        : c(false, 'value', 'slot became optional')
  }
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function diffComponent(
  name: string,
  a: SnapshotComponent,
  b: SnapshotComponent,
  aspects: ComponentAspect[],
): ChangeOp[] {
  const ops: ChangeOp[] = []
  const base = `components.${name}`
  if (aspects.includes('variants')) {
    for (const [axis, options] of Object.entries(a.variants)) {
      const after = b.variants[axis]
      if (!after) ops.push({ kind: 'variant_axis.removed', path: `${base}.variants.${axis}`, options })
      else {
        for (const o of options)
          if (!after.includes(o))
            ops.push({ kind: 'variant.removed', path: `${base}.variants.${axis}`, option: o })
        for (const o of after)
          if (!options.includes(o))
            ops.push({ kind: 'variant.added', path: `${base}.variants.${axis}`, option: o })
      }
    }
    for (const [axis, options] of Object.entries(b.variants)) {
      if (!a.variants[axis])
        ops.push({ kind: 'variant_axis.added', path: `${base}.variants.${axis}`, options })
    }
  }
  if (aspects.includes('props')) {
    for (const [prop, before] of Object.entries(a.props)) {
      const after = b.props[prop]
      const path = `${base}.props.${prop}`
      if (!after) {
        ops.push({ kind: 'prop.removed', path, before })
        continue
      }
      for (const field of ['type', 'required', 'default', 'values'] as const) {
        if (!sameJson(before[field], after[field]))
          ops.push({ kind: 'prop.changed', path, field, before: before[field], after: after[field] })
      }
    }
    for (const [prop, after] of Object.entries(b.props)) {
      if (!a.props[prop]) ops.push({ kind: 'prop.added', path: `${base}.props.${prop}`, after })
    }
  }
  if (aspects.includes('states')) {
    for (const s of a.states)
      if (!b.states.includes(s)) ops.push({ kind: 'state.removed', path: `${base}.states.${s}`, state: s })
    for (const s of b.states)
      if (!a.states.includes(s)) ops.push({ kind: 'state.added', path: `${base}.states.${s}`, state: s })
  }
  if (aspects.includes('slots')) {
    for (const [slot, before] of Object.entries(a.slots)) {
      const after = b.slots[slot]
      const path = `${base}.slots.${slot}`
      if (!after) ops.push({ kind: 'slot.removed', path, before })
      else if (after !== before) ops.push({ kind: 'slot.changed', path, before, after })
    }
    for (const [slot, after] of Object.entries(b.slots)) {
      if (!a.slots[slot]) ops.push({ kind: 'slot.added', path: `${base}.slots.${slot}`, after })
    }
  }
  return ops
}

/**
 * Semantic diff from one snapshot to another. Only what both sides cover is compared.
 * A removed and an added token with the same type and value (and no other candidate) are reported as a rename.
 */
export function diffSnapshots(from: Snapshot, to: Snapshot): ChangeOp[] {
  const ops: ChangeOp[] = []
  const covered = (path: string) => coversToken(from.coverage, path) && coversToken(to.coverage, path)

  const removed: [string, SnapshotToken][] = []
  const added: [string, SnapshotToken][] = []
  for (const [path, before] of from.tokens) {
    if (!covered(path)) continue
    const after = to.tokens.get(path)
    const p = `tokens.${path}`
    if (!after) {
      removed.push([path, before])
      continue
    }
    if (before.type !== after.type) {
      ops.push({ kind: 'token.type_changed', path: p, before: before.type, after: after.type })
      continue
    }
    if (!valuesEqual(before.type, before.value, after.value)) {
      ops.push({
        kind: 'token.value_changed',
        path: p,
        type: before.type,
        before: before.value,
        after: after.value,
      })
    }
    // Only compare references when both sides express them; a flat surface (CSS export) has none.
    if (before.aliasOf !== after.aliasOf && before.aliasOf !== undefined && after.aliasOf !== undefined) {
      ops.push({ kind: 'token.alias_changed', path: p, before: before.aliasOf, after: after.aliasOf })
    }
    if (Boolean(before.deprecated) !== Boolean(after.deprecated)) {
      ops.push({
        kind: 'token.deprecated_changed',
        path: p,
        before: before.deprecated,
        after: after.deprecated,
      })
    }
  }
  for (const [path, after] of to.tokens) {
    if (covered(path) && !from.tokens.has(path)) added.push([path, after])
  }

  // Rename detection: unique same-type, same-value pairs.
  const matches = (a: SnapshotToken, b: SnapshotToken) =>
    a.type === b.type && valuesEqual(a.type, a.value, b.value)
  const renamedFrom = new Set<string>()
  const renamedTo = new Set<string>()
  for (const [oldPath, oldToken] of removed) {
    const candidates = added.filter(([, t]) => matches(oldToken, t))
    if (candidates.length !== 1) continue
    const [newPath, newToken] = candidates[0] as [string, SnapshotToken]
    if (removed.filter(([, t]) => matches(t, newToken)).length !== 1) continue
    ops.push({ kind: 'token.renamed', path: `tokens.${oldPath}`, to: `tokens.${newPath}`, token: newToken })
    renamedFrom.add(oldPath)
    renamedTo.add(newPath)
  }
  for (const [path, before] of removed)
    if (!renamedFrom.has(path)) ops.push({ kind: 'token.removed', path: `tokens.${path}`, before })
  for (const [path, after] of added)
    if (!renamedTo.has(path)) ops.push({ kind: 'token.added', path: `tokens.${path}`, after })

  ops.push(...diffContexts(from, to, covered))

  const aspects = from.coverage.components.filter((a) => to.coverage.components.includes(a))
  if (aspects.length > 0) {
    for (const [name, before] of from.components) {
      const after = to.components.get(name)
      if (!after) ops.push({ kind: 'component.removed', path: `components.${name}`, before })
      else ops.push(...diffComponent(name, before, after, aspects))
    }
    for (const [name, after] of to.components) {
      if (!from.components.has(name)) ops.push({ kind: 'component.added', path: `components.${name}`, after })
    }
  }
  return ops
}

/**
 * Values per context, for the contexts both sides carry. A token that neither side sets in a context falls
 * back to its default there, so its difference is the default one and is reported once, without context.
 */
function diffContexts(from: Snapshot, to: Snapshot, covered: (path: string) => boolean): ChangeOp[] {
  const ops: ChangeOp[] = []
  for (const key of sharedContexts(from.coverage, to.coverage)) {
    const context = parseContextKey(key)
    const a = from.contexts?.get(key) ?? new Map<string, SnapshotToken>()
    const b = to.contexts?.get(key) ?? new Map<string, SnapshotToken>()
    for (const path of new Set([...a.keys(), ...b.keys()])) {
      const fromBase = from.tokens.get(path)
      const toBase = to.tokens.get(path)
      // Added, removed or retyped tokens are reported once, for all contexts.
      if (!covered(path) || !fromBase || !toBase || fromBase.type !== toBase.type) continue
      const before = a.get(path) ?? fromBase
      const after = b.get(path) ?? toBase
      // The same reference on both sides: the value moved with its target, which is reported itself.
      if (before.aliasOf !== undefined && before.aliasOf === after.aliasOf) continue
      const p = `tokens.${path}`
      if (!valuesEqual(fromBase.type, before.value, after.value)) {
        const op: ChangeOp = {
          kind: 'token.value_changed',
          path: p,
          type: fromBase.type,
          before: before.value,
          after: after.value,
          context,
        }
        if (!a.has(path)) op.fallback = 'before'
        else if (!b.has(path)) op.fallback = 'after'
        ops.push(op)
      }
      if (before.aliasOf !== after.aliasOf && before.aliasOf !== undefined && after.aliasOf !== undefined)
        ops.push({
          kind: 'token.alias_changed',
          path: p,
          before: before.aliasOf,
          after: after.aliasOf,
          context,
        })
    }
  }
  return ops
}

/**
 * Stable identity of a change, used to line up the sides of a three-way diff.
 * Changes to different facets of the same entry (value vs. deprecation, two prop fields) get different keys.
 */
export function opKey(op: ChangeOp): string {
  switch (op.kind) {
    case 'token.value_changed':
    case 'token.alias_changed':
      return `value:${op.path}${op.context ? `@${contextKey(op.context)}` : ''}`
    case 'token.type_changed':
      return `value:${op.path}`
    case 'token.deprecated_changed':
      return `deprecated:${op.path}`
    case 'variant.added':
    case 'variant.removed':
      return `variant:${op.path}=${op.option}`
    case 'prop.changed':
      return `prop:${op.path}.${op.field}`
    case 'slot.changed':
      return `slot:${op.path}`
    default:
      return `exist:${op.path}`
  }
}
