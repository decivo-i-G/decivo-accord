import {
  ACCORD_EXTENSION_KEY,
  FONT_WEIGHT_ALIASES,
  TOKEN_TYPES,
  TOKENS_STUDIO_TYPES,
  type Token,
  type TokenFile,
  type TokenType,
  upgradeLegacyDtcg,
} from '@decivo/accord-core'
import { toTokenValue } from './surface.js'

/** A variable of a design tool (Figma, Pencil) in its default mode, as the first register is built from it. */
export interface DesignVariable {
  /** Name as the surface adapter matches it, e.g. `Color.Brand.500` or `--primary`. */
  name: string
  /** The name's parts as written in the tool; default: `name` split at dots. */
  segments?: string[] | undefined
  type?: string | undefined
  /** Figma scopes, which say what a number or string is for. */
  scopes?: string[] | undefined
  /** Resolved value: CSS string, number, or an already typed DTCG value. */
  value: unknown
  /** Name of the variable this one is an alias of; kept as a DTCG reference when that one is taken over too. */
  alias?: string | undefined
  /** CSS variable the tool names for code (Figma code syntax). */
  cssVariable?: string | undefined
}

export interface DesignImport {
  files: TokenFile[]
  /** Variables not taken over: no token type (booleans, text), no value, an unusable name or a duplicate. */
  skipped: { name: string; reason: 'type' | 'value' | 'name' | 'duplicate' }[]
  /** Register path each taken variable got, by variable name (`Color.Brand` → `color.brand.$root`). */
  paths: Map<string, string>
}

const DIMENSION_SCOPES = new Set([
  'CORNER_RADIUS',
  'GAP',
  'WIDTH_HEIGHT',
  'STROKE_FLOAT',
  'FONT_SIZE',
  'LETTER_SPACING',
  'PARAGRAPH_SPACING',
  'PARAGRAPH_INDENT',
  'EFFECT_FLOAT',
])
const KNOWN_TYPES = new Map<string, TokenType>([
  ...Object.entries(TOKENS_STUDIO_TYPES).map(([k, v]) => [k.toLowerCase(), v] as const),
  ...TOKEN_TYPES.map((t) => [t.toLowerCase(), t] as const),
])
const isWeight = (text: string | undefined) =>
  text !== undefined && (/^\d+$/.test(text) || text.toLowerCase().replace(/\s+/g, '-') in FONT_WEIGHT_ALIASES)
const COLOR_STRING = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|oklab\()/i

/** The DTCG type of a design variable, from its declared type, Figma scopes and, for bare numbers, its name. */
export function designTokenType(v: DesignVariable): TokenType | undefined {
  const type = (v.type ?? '').toLowerCase()
  const scopes = v.scopes ?? []
  const name = (v.segments ?? v.name.split('.')).join('-').toLowerCase().replace(/\s+/g, '-')
  const text = typeof v.value === 'string' ? v.value.trim() : undefined
  if (type === 'color') return 'color'
  if (type === 'boolean' || type === 'bool') return undefined
  if (type === 'string' || type === 'text') {
    // Only real weights: "Light Italic" is a font style, which DTCG has no token type for.
    if (scopes.includes('FONT_WEIGHT') || /weight|(^|-)fw(-|$)/.test(name))
      return isWeight(text) ? 'fontWeight' : undefined
    if (
      scopes.includes('FONT_FAMILY') ||
      /font-?famil|typeface/.test(name) ||
      (/(^|-)font(-|$)/.test(name) && !/size|style|height|spacing|track|leading/.test(name))
    )
      return 'fontFamily'
    // Text variables often carry CSS: "150ms", "cubic-bezier(…)", "[0, 0, 0, 1]", "#fff", "16px".
    if (text === undefined) return undefined
    if (COLOR_STRING.test(text)) return 'color'
    if (/^-?\d+(\.\d+)?m?s$/.test(text)) return 'duration'
    if (/^cubic-bezier\(|^\[\s*-?[\d.]+(\s*,\s*-?[\d.]+){3}\s*\]$/.test(text)) return 'cubicBezier'
    if (/eas(e|ing)/.test(name) && /^(linear|ease(-in)?(-out)?)$/.test(text)) return 'cubicBezier'
    if (/^-?\d+(\.\d+)?(px|rem)$/.test(text)) return 'dimension'
    return undefined
  }
  if (type === '' && typeof v.value === 'string' && COLOR_STRING.test(v.value)) return 'color'
  if (type === 'float' || type === 'number' || type === '') {
    if (type === '' && typeof v.value !== 'number') return undefined
    if (scopes.includes('FONT_WEIGHT')) return 'fontWeight'
    if (scopes.includes('OPACITY') || scopes.includes('LINE_HEIGHT')) return 'number'
    if (scopes.some((s) => DIMENSION_SCOPES.has(s))) return 'dimension'
    if (/weight/.test(name)) return 'fontWeight'
    if (/duration|delay/.test(name)) return 'duration'
    if (/opacity|alpha|z-?index|line-?height|leading|ratio|scale|order|columns|flex/.test(name))
      return 'number'
    if (
      /radius|radii|rounded|spac|gap|size|width|height|padding|margin|inset|border|stroke|offset|blur|spread|breakpoint|screen|indent|tracking|letter|font|text|icon|gutter|space/.test(
        name,
      )
    )
      return 'dimension'
    return 'number'
  }
  return KNOWN_TYPES.get(type)
}

/** One name part as a register segment: lowercase words joined by `-` (`⭕️ Border radius` → `border-radius`). */
const segment = (part: string) =>
  part
    .trim()
    .toLowerCase()
    .replace(/\./g, '_')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^[-_]+|[-_]+$/g, '')

const GROUP: Partial<Record<TokenType, string>> = {
  color: 'color',
  dimension: 'dimension',
  fontFamily: 'font-family',
  fontWeight: 'font-weight',
  duration: 'duration',
  number: 'number',
}

type Obj = Record<string, unknown>

/**
 * The register path a design variable gets: its name parts in register style, a bare name in the group of
 * its type (`--primary` → `color.primary`). Empty when no part of the name is usable.
 */
export function designPath(v: Pick<DesignVariable, 'name' | 'segments'>, type: TokenType): string[] {
  const path = (v.segments ?? v.name.split('.')).map(segment).filter(Boolean)
  if (path.length === 1) {
    const group = GROUP[type] ?? type.toLowerCase()
    const own = path[0] as string
    path.splice(0, 1, group, own.startsWith(`${group}-`) ? own.slice(group.length + 1) : own)
  }
  return path
}

/**
 * Build the first register's token files from a design tool's variables: one file per top-level group,
 * register-style names (lowercase, `-`), aliases kept as DTCG references, and the tool's own name kept
 * under `ids.<surface>` wherever it differs, so later comparisons match exactly. Values still have to pass
 * the register's validation; whatever does not is left out there.
 */
export function tokensFromDesign(
  variables: readonly DesignVariable[],
  surface: 'figma' | 'pen',
): DesignImport {
  const skipped: DesignImport['skipped'] = []
  const taken: { v: DesignVariable; type: TokenType; path: string[] }[] = []
  const used = new Set<string>()
  for (const v of variables) {
    const type = designTokenType(v)
    if (!type) {
      skipped.push({ name: v.name, reason: 'type' })
      continue
    }
    if (v.value === undefined || v.value === null) {
      skipped.push({ name: v.name, reason: 'value' })
      continue
    }
    const path = designPath(v, type)
    if (path.length === 0) {
      skipped.push({ name: v.name, reason: 'name' })
      continue
    }
    const key = path.join('.')
    if (used.has(key)) {
      skipped.push({ name: v.name, reason: 'duplicate' })
      continue
    }
    used.add(key)
    taken.push({ v, type, path })
  }

  // A token that is also a group (`color.brand` and `color.brand.light`) becomes the group's `$root`.
  for (const t of taken) {
    const key = t.path.join('.')
    if ([...used].some((p) => p.startsWith(`${key}.`))) t.path.push('$root')
  }
  const byName = new Map(taken.map((t) => [t.v.name, t]))

  const files = new Map<string, Obj>()
  for (const { v, type, path } of taken) {
    // An alias stays a reference only where it means the same value: across collections Figma resolves
    // it in the mode of the target collection, which may not be the one taken over.
    const target = v.alias ? byName.get(v.alias) : undefined
    const sameValue = target && JSON.stringify(target.v.value) === JSON.stringify(v.value)
    const node: Obj = {
      $type: type,
      // Read the value the way the surface status reads it later, so both agree from the start.
      $value:
        target && sameValue && target.type === type && target.v !== v
          ? `{${target.path.join('.')}}`
          : (toTokenValue({ type } as Token, v.value) ?? v.value),
    }
    const ids: Record<string, string> = {}
    if (v.name !== path.filter((s) => s !== '$root').join('.')) ids[surface] = v.name
    if (v.cssVariable) ids.css = v.cssVariable
    if (Object.keys(ids).length > 0) node.$extensions = { [ACCORD_EXTENSION_KEY]: { ids } }
    const group = path[0] as string
    let parent = files.get(group) ?? {}
    files.set(group, parent)
    for (const seg of path.slice(0, -1)) {
      parent[seg] = (parent[seg] as Obj | undefined) ?? {}
      parent = parent[seg] as Obj
    }
    parent[path.at(-1) as string] = node
  }

  return {
    files: [...files].map(([group, content]) => {
      upgradeLegacyDtcg(content)
      return { file: `tokens/${group}.tokens.json`, content }
    }),
    skipped,
    paths: new Map(taken.map((t) => [t.v.name, t.path.join('.')])),
  }
}
