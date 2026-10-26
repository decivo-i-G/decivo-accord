import {
  classify,
  contextForMode,
  contextKey,
  type DriftItem,
  type Lock,
  lockedSnapshot,
  type Register,
  restrictTo,
  type Snapshot,
  type SnapshotToken,
  type SurfaceId,
  snapshotFromRegister,
  THEME_MODIFIER,
  type Token,
  threeWayDiff,
} from '@decivo/accord-core'
import { cssToTokenValue } from './snapshot.js'

/** A variable as a design surface (Pencil, Figma) holds it: a name, a value, values per other mode. */
export interface SurfaceVariable {
  name: string
  /** Value in the default mode; a CSS string, a number, or an already typed DTCG value. */
  value: unknown
  /** Values that differ from the default in another mode, e.g. `{ mode: 'dark' }`. */
  themed: { theme: Record<string, string>; value: unknown }[]
  file: string
}

export interface VariableSurfaceStatus {
  snapshot: Snapshot
  /** Differences to the register, judged against the last sync of this surface in the lock. */
  items: DriftItem[]
  /** Register tokens the surface does not define and never did (outside its coverage, never drift). */
  missing: string[]
  /** Surface variables without a register token: candidates for a proposal. */
  unmapped: SurfaceVariable[]
  /** Variables whose value cannot be read as their token's type. */
  unreadable: { path: string; variable: string; value: unknown }[]
  /** Mode-dependent values per token, as the surface has them (all modes, mapped to a context or not). */
  themed: { path: string; themed: SurfaceVariable['themed'] }[]
  /** Register contexts this surface was compared in (e.g. `dark` for Figma's Dark mode); empty without modes. */
  contexts: string[]
}

const SURFACE_TYPES = ['color', 'dimension', 'number', 'fontWeight', 'fontFamily', 'duration']

/** A surface value as the token's DTCG value: numbers are px/ms, strings are CSS, objects are already typed. */
export function toTokenValue(token: Token, value: unknown): unknown {
  if (typeof value === 'number') {
    if (token.type === 'dimension') return { value, unit: 'px' }
    if (token.type === 'duration') return { value, unit: 'ms' }
    if (token.type === 'number' || token.type === 'fontWeight') return value
    return undefined
  }
  if (typeof value === 'string') return cssToTokenValue(token.type, value)
  if (typeof value === 'object' && value !== null) {
    if (token.type === 'color' && 'colorSpace' in value) return value
    if (token.type === 'color' && 'hex' in value && typeof value.hex === 'string')
      return cssToTokenValue('color', value.hex)
    if ((token.type === 'dimension' || token.type === 'duration') && 'value' in value && 'unit' in value)
      return value
  }
  return undefined
}

/** Lowercase, spaces and slashes as in Figma names ("Color / Brand 700") folded into register style. */
export const normaliseName = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/\s*\/\s*/g, '.')
    .replace(/\s+/g, '-')

/**
 * Compare the variables of a design surface with the register. A token matches the first variable
 * among its candidate names (exact, then normalised); only matched tokens are compared, three-way
 * against the surface's last sync in the lock, like every other surface.
 */
export function variableSurfaceStatus(input: {
  surface: SurfaceId
  variables: readonly SurfaceVariable[]
  register: Register
  lock: Lock
  /** Names a token may have on this surface, most specific first. */
  names: (token: Token) => string[]
  /**
   * Mode or theme values the surface has besides its default (Figma `Dark`, Pencil `dark`). Those that stand for
   * a register context are compared there; a value the surface does not set falls back to its default.
   */
  modes?: readonly string[] | undefined
}): VariableSurfaceStatus {
  const register = input.register
  /** Register context of a surface theme such as `{ mode: 'Dark' }`. */
  const contextOf = (theme: Record<string, string>) =>
    Object.values(theme)
      .map((v) => contextForMode(register, v))
      .find((c) => c !== undefined && c !== register.modes?.default)
  const carried = [
    ...new Set(
      (input.modes ?? [])
        .map((m) => contextForMode(register, m))
        .filter((c): c is string => c !== undefined && c !== register.modes?.default),
    ),
  ]
  const exact = new Map<string, SurfaceVariable>()
  const loose = new Map<string, SurfaceVariable>()
  for (const v of input.variables) {
    if (!exact.has(v.name)) exact.set(v.name, v)
    const n = normaliseName(v.name)
    if (!loose.has(n)) loose.set(n, v)
  }

  const tokens = new Map<string, SnapshotToken>()
  const perContext = new Map(carried.map((c) => [c, new Map<string, SnapshotToken>()]))
  const used = new Set<SurfaceVariable>()
  const missing: string[] = []
  const unreadable: VariableSurfaceStatus['unreadable'] = []
  const themed: VariableSurfaceStatus['themed'] = []
  for (const token of input.register.tokens.values()) {
    if (!SURFACE_TYPES.includes(token.type)) continue
    const candidates = input.names(token)
    const variable =
      candidates.map((n) => exact.get(n)).find(Boolean) ??
      candidates.map((n) => loose.get(normaliseName(n))).find(Boolean)
    if (!variable) {
      missing.push(token.path)
      continue
    }
    used.add(variable)
    const value = variable.value === undefined ? undefined : toTokenValue(token, variable.value)
    if (value === undefined) {
      unreadable.push({ path: token.path, variable: variable.name, value: variable.value })
      continue
    }
    tokens.set(token.path, { type: token.type, value })
    if (variable.themed.length > 0) themed.push({ path: token.path, themed: variable.themed })
    for (const entry of variable.themed) {
      const context = contextOf(entry.theme)
      const values = context ? perContext.get(context) : undefined
      const inContext = values ? toTokenValue(token, entry.value) : undefined
      if (values && inContext !== undefined) values.set(token.path, { type: token.type, value: inContext })
    }
  }

  const snapshot: Snapshot = {
    tokens,
    components: new Map(),
    coverage: {
      tokens: [...tokens.keys()],
      components: [],
      ...(perContext.size > 0
        ? { contexts: carried.map((c) => contextKey({ [register.modes?.modifier ?? THEME_MODIFIER]: c })) }
        : {}),
    },
    ...(perContext.size > 0
      ? {
          contexts: new Map(
            [...perContext].map(([c, values]) => [
              contextKey({ [register.modes?.modifier ?? THEME_MODIFIER]: c }),
              values,
            ]),
          ),
        }
      : {}),
  }
  const base = lockedSnapshot(input.lock, input.surface)
  const items = threeWayDiff({
    base,
    register: restrictTo(snapshotFromRegister(input.register), snapshot.coverage),
    surface: snapshot,
  })
  // A token the surface had at its last sync and no longer has was deleted there. Deletions are breaking,
  // so they are drift like any other change: a person decides, nothing is removed by itself.
  const deleted = new Set<string>()
  for (const path of missing) {
    const before = base?.tokens.get(path)
    if (!before) continue
    deleted.add(path)
    const op = { kind: 'token.removed' as const, path: `tokens.${path}`, before }
    items.push({ op, origin: 'surface', classification: classify(op) })
  }
  return {
    snapshot,
    items,
    missing: missing.filter((p) => !deleted.has(p)),
    unmapped: input.variables.filter((v) => !used.has(v) && exact.get(v.name) === v),
    unreadable,
    themed,
    contexts: carried,
  }
}
