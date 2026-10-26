import {
  type ColorValue,
  type DimensionValue,
  deltaE,
  dimensionToPx,
  type Token,
  valuesEqual,
} from '@decivo/accord-core'
import type { DimensionCategory } from './hard-values.js'

/** Lookup of register tokens by value, for mapping literal values back to tokens. */
export interface TokenIndex {
  colors: IndexedToken<ColorValue>[]
  dimensions: IndexedToken<DimensionValue>[]
}

interface IndexedToken<V> {
  path: string
  value: V
  deprecated: boolean
  /** How many tokens alias this one; primitives everyone points to make better replacements. */
  referencedBy: number
  /** How often the token's CSS variable is already used in code. */
  usage: number
  /** Whether the token's CSS variable exists in the code's stylesheets, so a suggestion `var(--x)` works. */
  defined: boolean
}

export function buildTokenIndex(
  tokens: Iterable<Token>,
  usage: ReadonlyMap<string, number> = new Map(),
  /** Token paths whose CSS variable the code defines; without stylesheets every token counts as defined. */
  defined?: ReadonlySet<string>,
): TokenIndex {
  const all = [...tokens]
  const references = new Map<string, number>()
  for (const t of all) if (t.aliasOf) references.set(t.aliasOf, (references.get(t.aliasOf) ?? 0) + 1)
  const index: TokenIndex = { colors: [], dimensions: [] }
  for (const token of all) {
    if (token.value === undefined) continue
    const entry = {
      path: token.path,
      deprecated: Boolean(token.deprecated),
      referencedBy: references.get(token.path) ?? 0,
      usage: usage.get(token.path) ?? 0,
      defined: defined === undefined || defined.has(token.path),
    }
    if (token.type === 'color') index.colors.push({ ...entry, value: token.value as ColorValue })
    if (token.type === 'dimension') index.dimensions.push({ ...entry, value: token.value as DimensionValue })
  }
  return index
}

const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w && w !== 'color' && w !== 'root'),
  )

/**
 * Order candidates: not deprecated, then with a CSS variable the code defines (a suggestion must work),
 * then sharing words with `hint` (a CSS variable name), then already used most in code, then referenced
 * by other tokens, then the shortest name.
 */
function rank<V>(candidates: IndexedToken<V>[], hint?: string): string[] {
  const hintWords = hint ? words(hint) : new Set<string>()
  const overlap = (path: string) => [...words(path)].filter((w) => hintWords.has(w)).length
  return [...candidates]
    .sort(
      (a, b) =>
        Number(a.deprecated) - Number(b.deprecated) ||
        Number(b.defined) - Number(a.defined) ||
        overlap(b.path) - overlap(a.path) ||
        b.usage - a.usage ||
        b.referencedBy - a.referencedBy ||
        a.path.length - b.path.length ||
        a.path.localeCompare(b.path),
    )
    .map((t) => t.path)
}

export interface TokenMatch {
  /** Tokens with exactly this value, preferred first. */
  exact: string[]
  /** Closest token if none matches exactly but one is within the near-miss threshold. */
  near?: { path: string; distance: number } | undefined
}

export function matchColor(
  index: TokenIndex,
  color: ColorValue,
  nearDeltaE: number,
  hint?: string,
): TokenMatch {
  const exact = rank(
    index.colors.filter((t) => valuesEqual('color', t.value, color)),
    hint,
  )
  if (exact.length > 0) return { exact }
  let near: TokenMatch['near']
  for (const t of index.colors) {
    if ((t.value.alpha ?? 1) !== (color.alpha ?? 1) || t.deprecated) continue
    const distance = deltaE(t.value, color)
    if (distance <= nearDeltaE && (!near || distance < near.distance)) {
      near = { path: t.path, distance: Math.round(distance * 100) / 100 }
    }
  }
  return { exact, near }
}

/** What a dimension token is for, judged by its name. */
export function tokenDimensionCategory(path: string): DimensionCategory | undefined {
  const p = path.toLowerCase()
  if (/radius|rounded|corner/.test(p)) return 'radius'
  if (/letter|tracking/.test(p)) return 'letterSpacing'
  if (/font|text|typo|heading|body|display/.test(p)) return 'fontSize'
  if (/spac|space|gap|pad|margin|gutter|inset|section|stack/.test(p)) return 'spacing'
  return undefined
}

/** Tokens with the same length; with a category, only tokens of that kind (no radius token for a font size). */
export function matchDimension(
  index: TokenIndex,
  dimension: DimensionValue,
  category?: DimensionCategory,
  hint?: string,
): TokenMatch {
  const px = dimensionToPx(dimension)
  const candidates = category
    ? index.dimensions.filter((t) => tokenDimensionCategory(t.path) === category)
    : index.dimensions
  return {
    exact: rank(
      candidates.filter((t) => Math.abs(dimensionToPx(t.value) - px) < 0.01),
      hint,
    ),
  }
}
