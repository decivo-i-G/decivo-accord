import { dimensionToPx } from '../css-values.js'
import { colorAlpha, colorToHex } from '../dtcg/color.js'
import {
  type ColorValue,
  type DimensionValue,
  FONT_WEIGHT_ALIASES,
  type Token,
  type TokenType,
} from '../dtcg/types.js'
import { type RegisterModes, setsInContext } from '../modes/contexts.js'
import { contextKey, type ModeContext } from '../modes/resolver.js'
import { matchPath } from '../paths.js'
import type { Register } from '../register.js'

/**
 * The normalised shape every surface is translated into, so the register, code, Claude Design,
 * Figma and Pen can be compared field by field. Values are resolved (no aliases).
 */
export interface SnapshotToken {
  type: TokenType
  value: unknown
  /** Token this one points to, if the surface expresses it as a reference. */
  aliasOf?: string
  deprecated?: boolean | string
}

export interface SnapshotProp {
  type: string
  required: boolean
  default?: unknown
  values?: string[]
}

export interface SnapshotComponent {
  variants: Record<string, string[]>
  props: Record<string, SnapshotProp>
  states: string[]
  slots: Record<string, 'required' | 'optional'>
}

export type ComponentAspect = 'variants' | 'props' | 'states' | 'slots'
export const COMPONENT_ASPECTS: readonly ComponentAspect[] = ['variants', 'props', 'states', 'slots']

/**
 * What a surface can express. Claude Design has no prop API, a CSS file has no components.
 * Things outside the coverage are never reported as missing or deleted.
 */
export interface Coverage {
  /** Token path patterns (without `tokens.`) the surface carries, e.g. `color.**`. */
  tokens: string[]
  /** Component aspects the surface carries. Empty means no components at all. */
  components: ComponentAspect[]
  /**
   * Non-default contexts the surface carries, as keys like `theme=dark` (a CSS `.dark` block, a Figma
   * mode "Dark", a Pencil theme). Without them, values per context are never compared.
   */
  contexts?: string[] | undefined
}

export interface Snapshot {
  /** Values in the default context (light), or the only values where there are no contexts. */
  tokens: Map<string, SnapshotToken>
  components: Map<string, SnapshotComponent>
  coverage: Coverage
  /**
   * Values per non-default context (key `theme=dark`), only for tokens whose value there is their own: set in
   * that context, or different from the default through an alias. Every other token falls back to `tokens`.
   */
  contexts?: Map<string, Map<string, SnapshotToken>> | undefined
}

export const FULL_COVERAGE: Coverage = { tokens: ['**'], components: [...COMPONENT_ASPECTS] }

export const coversToken = (coverage: Coverage, path: string) =>
  coverage.tokens.some((p) => matchPath(p, path))

/** The value a context holds for a token, when it differs from falling back to `base`; else undefined. */
export function contextValue(
  modes: RegisterModes,
  context: string,
  path: string,
  base: SnapshotToken,
): SnapshotToken | undefined {
  const token = modes.tokens.get(context)?.get(path)
  if (!token || token.value === undefined) return undefined
  const own = setsInContext({ modes }, context, path)
  if (!own && valuesEqual(base.type, base.value, token.value) && token.aliasOf === base.aliasOf)
    return undefined
  const entry: SnapshotToken = { type: base.type, value: token.value }
  if (token.aliasOf !== undefined) entry.aliasOf = token.aliasOf
  return entry
}

/**
 * The register itself as a snapshot. Tokens inherited through `$extends` are included under their own path;
 * with modes, every non-default context is included and covered.
 */
export function snapshotFromRegister(
  register: Pick<Register, 'tokens' | 'components'> & { modes?: RegisterModes | undefined },
): Snapshot {
  const tokens = new Map<string, SnapshotToken>()
  for (const token of register.tokens.values()) {
    if (token.value === undefined) continue
    const entry: SnapshotToken = { type: token.type, value: token.value }
    if (token.aliasOf !== undefined) entry.aliasOf = token.aliasOf
    if (token.deprecated !== undefined) entry.deprecated = token.deprecated
    tokens.set(token.path, entry)
  }
  const modes = register.modes
  let contexts: Snapshot['contexts']
  if (modes) {
    contexts = new Map()
    for (const context of modes.contexts.filter((c) => c !== modes.default)) {
      const values = new Map<string, SnapshotToken>()
      for (const [path, base] of tokens) {
        const value = contextValue(modes, context, path, base)
        if (value) values.set(path, value)
      }
      contexts.set(contextKey({ [modes.modifier]: context }), values)
    }
  }
  const components = new Map<string, SnapshotComponent>()
  for (const c of register.components.values()) {
    const props: Record<string, SnapshotProp> = {}
    for (const [name, p] of Object.entries(c.props)) {
      const prop: SnapshotProp = { type: p.type, required: p.required }
      if (p.default !== undefined) prop.default = p.default
      if (p.values !== undefined) prop.values = p.values
      props[name] = prop
    }
    components.set(c.name, { variants: c.variants, props, states: c.states, slots: c.slots })
  }
  if (!contexts) return { tokens, components, coverage: FULL_COVERAGE }
  return { tokens, components, coverage: { ...FULL_COVERAGE, contexts: [...contexts.keys()] }, contexts }
}

/**
 * Tokens whose value in `context` is their own (set there, or different through an alias), resolved in that
 * context, in register order. Every other token has its default value there.
 */
export function tokensDifferingIn(
  register: Pick<Register, 'tokens'> & { modes?: RegisterModes | undefined },
  context: string,
): Token[] {
  const modes = register.modes
  if (!modes || context === modes.default) return []
  const out: Token[] = []
  for (const token of register.tokens.values()) {
    if (token.value === undefined) continue
    const base: SnapshotToken = { type: token.type, value: token.value }
    if (token.aliasOf !== undefined) base.aliasOf = token.aliasOf
    const inContext = modes.tokens.get(context)?.get(token.path)
    if (inContext && contextValue(modes, context, token.path, base)) out.push(inContext)
  }
  return out
}

/** Value of a snapshot token in a context key (`theme=dark`): its own there, else the default. */
export const valueInContext = (snapshot: Snapshot, key: string | undefined, path: string) =>
  (key === undefined ? undefined : snapshot.contexts?.get(key)?.get(path)) ?? snapshot.tokens.get(path)

/** Contexts both coverages carry. */
export const sharedContexts = (a: Coverage, b: Coverage): string[] =>
  (a.contexts ?? []).filter((k) => (b.contexts ?? []).includes(k))

/** The context key of a mode context, or undefined for none. */
export const keyOf = (context: ModeContext | undefined) => (context ? contextKey(context) : undefined)

/**
 * Restrict a snapshot to another snapshot's coverage, so like is compared with like. Contexts are kept only
 * where both carry them: a register without modes is never compared on a surface's dark values.
 */
export function restrictTo(snapshot: Snapshot, coverage: Coverage): Snapshot {
  const tokens = new Map([...snapshot.tokens].filter(([path]) => coversToken(coverage, path)))
  const shared = sharedContexts(snapshot.coverage, coverage)
  const components = new Map<string, SnapshotComponent>()
  if (coverage.components.length > 0) {
    for (const [name, c] of snapshot.components) {
      components.set(name, {
        variants: coverage.components.includes('variants') ? c.variants : {},
        props: coverage.components.includes('props') ? c.props : {},
        states: coverage.components.includes('states') ? c.states : [],
        slots: coverage.components.includes('slots') ? c.slots : {},
      })
    }
  }
  if (shared.length === 0) {
    if (coverage.contexts === undefined) return { tokens, components, coverage }
    const { contexts: _contexts, ...rest } = coverage
    return { tokens, components, coverage: rest }
  }
  const contexts = new Map(
    shared.map((key) => [
      key,
      new Map(
        [...(snapshot.contexts?.get(key) ?? new Map<string, SnapshotToken>())].filter(([path]) =>
          coversToken(coverage, path),
        ),
      ),
    ]),
  )
  return { tokens, components, coverage: { ...coverage, contexts: shared }, contexts }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Semantic equality of two resolved token values of the same type.
 * Colours compare by hex + alpha (colour space and precision don't matter),
 * dimensions by pixels (16px equals 1rem), everything else structurally.
 */
export function valuesEqual(type: TokenType, a: unknown, b: unknown): boolean {
  if (type === 'color') {
    if (!isObject(a) || !isObject(b)) return false
    const ca = a as unknown as ColorValue
    const cb = b as unknown as ColorValue
    return colorToHex(ca) === colorToHex(cb) && Math.abs(colorAlpha(ca) - colorAlpha(cb)) < 0.005
  }
  if (type === 'dimension') {
    if (!isObject(a) || !isObject(b)) return false
    return (
      Math.abs(
        dimensionToPx(a as unknown as DimensionValue) - dimensionToPx(b as unknown as DimensionValue),
      ) < 0.01
    )
  }
  if (type === 'fontWeight') {
    // "bold" and 700 are the same weight.
    const weight = (v: unknown) => (typeof v === 'string' ? (FONT_WEIGHT_ALIASES[v.toLowerCase()] ?? v) : v)
    return weight(a) === weight(b)
  }
  if (type === 'fontFamily') {
    // "Inter" and ["Inter"] are the same stack; surrounding spaces do not count.
    const stack = (v: unknown) =>
      (Array.isArray(v) ? v : [v]).map((f) => (typeof f === 'string' ? f.trim() : f))
    return deepEqualWith(stack(a), stack(b))
  }
  return deepEqualWith(a, b)
}

/** Structural equality that applies colour/dimension equality to nested composite values. */
function deepEqualWith(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => deepEqualWith(x, b[i]))
  if (isObject(a) && isObject(b)) {
    if ('colorSpace' in a && 'colorSpace' in b) return valuesEqual('color', a, b)
    if ('unit' in a && 'unit' in b && (a.unit === 'px' || a.unit === 'rem'))
      return valuesEqual('dimension', a, b)
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    return [...keys].every((k) => deepEqualWith(a[k], b[k]))
  }
  return false
}

/** Short human-readable value for reports: `#3c6681`, `24px`, `Inter`. */
export function formatValue(type: TokenType, value: unknown): string {
  if (type === 'color' && isObject(value)) {
    const c = value as unknown as ColorValue
    const alpha = colorAlpha(c)
    return alpha < 1 ? `${colorToHex(c)} / ${Math.round(alpha * 100)}%` : colorToHex(c)
  }
  if (type === 'dimension' && isObject(value)) return `${value.value}${value.unit}`
  if (type === 'fontFamily') return Array.isArray(value) ? value.join(', ') : String(value)
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return JSON.stringify(value)
}

// --- serialisation for surfaces.lock.json ---

export interface SnapshotJson {
  tokens: Record<string, SnapshotToken>
  components: Record<string, SnapshotComponent>
  coverage: Coverage
  /** Own values per non-default context (`theme=dark`); absent without contexts. */
  contexts?: Record<string, Record<string, SnapshotToken>> | undefined
}

const sorted = <V>(map: Map<string, V>) => Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)))

export function snapshotToJson(s: Snapshot): SnapshotJson {
  const json: SnapshotJson = {
    tokens: sorted(s.tokens),
    components: sorted(s.components),
    coverage: s.coverage,
  }
  if (s.contexts && s.contexts.size > 0)
    json.contexts = Object.fromEntries(
      [...s.contexts].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sorted(v)]),
    )
  return json
}

export function snapshotFromJson(j: SnapshotJson): Snapshot {
  const snapshot: Snapshot = {
    tokens: new Map(Object.entries(j.tokens)),
    components: new Map(Object.entries(j.components)),
    coverage: j.coverage,
  }
  if (j.contexts)
    snapshot.contexts = new Map(Object.entries(j.contexts).map(([k, v]) => [k, new Map(Object.entries(v))]))
  return snapshot
}
