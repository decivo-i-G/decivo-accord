import {
  type ColorValue,
  colorAlpha,
  colorToCss,
  colorToHex,
  type Decision,
  type DimensionValue,
  dimensionToCss,
  dimensionToPx,
  explainOwner,
  formatValue,
  matchPath,
  type Owner,
  type OwnerSource,
  type Register,
  resolveOwner,
  type Token,
  type TokenType,
} from '@decivo/accord-core'

/**
 * View models of the register screen: what a token, component or decision looks like in the
 * table and the inspector. Pure functions over a loaded register (and, optionally, the code scan),
 * so they are cheap to test and the client only ever receives plain data.
 */

// --- Values and previews --------------------------------------------------------------------------

/** How a value is drawn: colours as swatches, radii as rounded boxes, lengths as bars, fonts in their face. */
export type Preview =
  | { kind: 'color'; css: string; hex: string; alpha: number }
  | { kind: 'radius'; css: string; px: number }
  | { kind: 'length'; css: string; px: number }
  | { kind: 'fontSize'; css: string; px: number }
  | { kind: 'fontFamily'; css: string }
  | { kind: 'fontWeight'; weight: number }
  | { kind: 'duration'; ms: number }
  | { kind: 'easing'; points: [number, number, number, number] }
  | { kind: 'shadow'; css: string }
  | { kind: 'none' }

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isDimension = (v: unknown): v is DimensionValue =>
  isObject(v) && typeof v.value === 'number' && (v.unit === 'px' || v.unit === 'rem')

const isColor = (v: unknown): v is ColorValue =>
  isObject(v) && typeof v.colorSpace === 'string' && Array.isArray(v.components)

const isDuration = (v: unknown): v is { value: number; unit: 'ms' | 's' } =>
  isObject(v) && typeof v.value === 'number' && (v.unit === 'ms' || v.unit === 's')

const durationMs = (v: { value: number; unit: 'ms' | 's' }) => (v.unit === 's' ? v.value * 1000 : v.value)

const isBezier = (v: unknown): v is [number, number, number, number] =>
  Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number')

/** A CSS font-family list, quoting names with spaces. */
export function fontFamilyCss(value: unknown): string {
  const names = Array.isArray(value) ? value.map(String) : String(value).split(',')
  return names
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => (/\s/.test(n) && !/^["'].*["']$/.test(n) ? `"${n}"` : n))
    .join(', ')
}

function colorText(c: ColorValue): string {
  const alpha = colorAlpha(c)
  return alpha < 1 ? `${colorToHex(c)} / ${Math.round(alpha * 100)}%` : colorToHex(c)
}

function shadowLayers(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isObject)
  return isObject(value) ? [value] : []
}

function shadowCss(value: unknown): string | undefined {
  const layers = shadowLayers(value)
  if (layers.length === 0) return undefined
  const parts: string[] = []
  for (const l of layers) {
    const lengths = [l.offsetX, l.offsetY, l.blur, l.spread]
    if (!lengths.every(isDimension) || !isColor(l.color)) return undefined
    const css = (lengths as DimensionValue[]).map(dimensionToCss).join(' ')
    parts.push(`${l.inset === true ? 'inset ' : ''}${css} ${colorToCss(l.color)}`)
  }
  return parts.join(', ')
}

/** Short human-readable value, e.g. `#3c6681`, `16px`, `cubic-bezier(0.2, 0, 0, 1)`. */
export function valueText(type: TokenType, value: unknown): string {
  if (value === undefined) return ''
  switch (type) {
    case 'color':
      return isColor(value) ? colorText(value) : formatValue(type, value)
    case 'dimension':
      return isDimension(value) ? dimensionToCss(value) : formatValue(type, value)
    case 'duration':
      return isDuration(value) ? `${value.value}${value.unit}` : formatValue(type, value)
    case 'cubicBezier':
      return isBezier(value) ? `cubic-bezier(${value.join(', ')})` : formatValue(type, value)
    case 'fontFamily':
      return Array.isArray(value) ? value.join(', ') : String(value)
    case 'shadow': {
      const layers = shadowLayers(value)
      const texts = layers.map((l) => {
        const lengths = [l.offsetX, l.offsetY, l.blur, l.spread].map((d) =>
          isDimension(d) ? dimensionToCss(d) : '?',
        )
        return `${l.inset === true ? 'inset ' : ''}${lengths.join(' ')} ${isColor(l.color) ? colorText(l.color) : ''}`.trim()
      })
      return texts.length > 0 ? texts.join(', ') : formatValue(type, value)
    }
    case 'typography': {
      if (!isObject(value)) return formatValue(type, value)
      const size = isDimension(value.fontSize) ? dimensionToCss(value.fontSize) : undefined
      const family = value.fontFamily === undefined ? undefined : valueText('fontFamily', value.fontFamily)
      const weight = value.fontWeight === undefined ? undefined : String(value.fontWeight)
      return [size, weight, family].filter(Boolean).join(' · ')
    }
    case 'border': {
      if (!isObject(value)) return formatValue(type, value)
      const width = isDimension(value.width) ? dimensionToCss(value.width) : ''
      const color = isColor(value.color) ? colorText(value.color) : ''
      return [width, typeof value.style === 'string' ? value.style : '', color].filter(Boolean).join(' ')
    }
    case 'transition': {
      if (!isObject(value)) return formatValue(type, value)
      const duration = isDuration(value.duration) ? `${value.duration.value}${value.duration.unit}` : ''
      const easing = isBezier(value.timingFunction) ? `cubic-bezier(${value.timingFunction.join(', ')})` : ''
      return [duration, easing].filter(Boolean).join(' ')
    }
    default:
      return formatValue(type, value)
  }
}

/** Which look a dimension gets, from its name (radius → rounded box, font size → "Aa", else a bar). */
function dimensionLook(path: string): 'radius' | 'fontSize' | 'length' {
  const p = path.toLowerCase()
  if (/radius|rounded|corner/.test(p)) return 'radius'
  if (/(^|[.-])(font|text|type)([.-]|$)/.test(p) && /size/.test(p)) return 'fontSize'
  return 'length'
}

export function previewOf(token: Pick<Token, 'path' | 'type' | 'value'>): Preview {
  const { value } = token
  switch (token.type) {
    case 'color':
      return isColor(value)
        ? { kind: 'color', css: colorToCss(value), hex: colorToHex(value), alpha: colorAlpha(value) }
        : { kind: 'none' }
    case 'dimension': {
      if (!isDimension(value)) return { kind: 'none' }
      return { kind: dimensionLook(token.path), css: dimensionToCss(value), px: dimensionToPx(value) }
    }
    case 'fontFamily':
      return value === undefined ? { kind: 'none' } : { kind: 'fontFamily', css: fontFamilyCss(value) }
    case 'fontWeight':
      return typeof value === 'number' ? { kind: 'fontWeight', weight: value } : { kind: 'none' }
    case 'duration':
      return isDuration(value) ? { kind: 'duration', ms: durationMs(value) } : { kind: 'none' }
    case 'cubicBezier':
      return isBezier(value) ? { kind: 'easing', points: value } : { kind: 'none' }
    case 'shadow': {
      const css = shadowCss(value)
      return css ? { kind: 'shadow', css } : { kind: 'none' }
    }
    default:
      return { kind: 'none' }
  }
}

// --- Names and grouping ---------------------------------------------------------------------------

/** Top-level group of a token (`color` for `color.brand.700`), like a Figma variable collection. */
export const groupOf = (path: string) => path.split('.')[0] ?? path

/** The token's name inside its group, without a trailing `$root`: `brand.700`, `ink`. */
export function nameInGroup(path: string): string {
  const rest = path.split('.').slice(1)
  const name = rest.filter((s, i) => !(s === '$root' && i === rest.length - 1)).join('.')
  return name || path
}

/**
 * Sub-group inside a group: the second segment for nested paths (`neutral` for `color.neutral.0`),
 * otherwise a scale name before a trailing number (`gray` for `color.gray-50`). Empty when none.
 */
export function familyOf(path: string): string {
  const segs = path.split('.')
  if (segs.length >= 3) return segs[1] ?? ''
  const name = segs[segs.length - 1] ?? ''
  return /^(.+?)-\d+$/.exec(name)?.[1] ?? ''
}

// --- Tokens ---------------------------------------------------------------------------------------

/** One row of the token table (sent to the client, so plain data only). */
export interface TokenRow {
  path: string
  group: string
  family: string
  name: string
  type: TokenType
  value: string
  preview: Preview
  alias?: string | undefined
  cssVar: string
  owner: Owner
  deprecated: boolean
  /** Lower-case text the search runs over: name, value, alias, CSS variable, description. */
  haystack: string
}

/** Tokens shown in the register: with a value, not copied in through `$extends`. */
export const visibleTokens = (register: Pick<Register, 'tokens'>) =>
  [...register.tokens.values()].filter((t) => t.value !== undefined && t.inheritedFrom === undefined)

export function tokenRows(register: Register, cssVar: (t: Token) => string): TokenRow[] {
  const tokens = visibleTokens(register)
  const families = new Map<string, Map<string, number>>()
  for (const t of tokens) {
    const g = groupOf(t.path)
    const counts = families.get(g) ?? new Map<string, number>()
    const f = familyOf(t.path)
    counts.set(f, (counts.get(f) ?? 0) + 1)
    families.set(g, counts)
  }
  return tokens.map((t) => {
    const group = groupOf(t.path)
    const family = familyOf(t.path)
    const value = valueText(t.type, t.value)
    const variable = cssVar(t)
    return {
      path: t.path,
      group,
      // A family of one is no family: it goes to the rest.
      family: (families.get(group)?.get(family) ?? 0) > 1 ? family : '',
      name: nameInGroup(t.path),
      type: t.type,
      value,
      preview: previewOf(t),
      alias: t.aliasOf,
      cssVar: variable,
      owner: resolveOwner(register, `tokens.${t.path}`).owner,
      deprecated: Boolean(t.deprecated),
      haystack: [t.path, value, value.replace('#', ''), t.aliasOf ?? '', variable, t.description ?? '']
        .join(' ')
        .toLowerCase(),
    }
  })
}

/**
 * A row's name under its family header, without the family repeated: `50` under `secondary`, the way
 * Figma lists `50 … 900` inside a group. Names outside a family, or not starting with it, stay whole.
 */
export function leafName(name: string, family: string): string {
  if (!family) return name
  for (const sep of ['-', '.', '_']) {
    const prefix = `${family}${sep}`
    if (name.startsWith(prefix) && name.length > prefix.length) return name.slice(prefix.length)
  }
  return name
}

/**
 * Everyday words people search for and the names design systems use for them (shadcn calls the brand
 * colour `primary`). The first entry a register has wins.
 */
const SYNONYMS: Record<string, readonly string[]> = {
  brand: ['primary', 'accent'],
  marke: ['brand', 'primary'],
  main: ['primary'],
  haupt: ['primary'],
  hauptfarbe: ['primary', 'brand'],
  primär: ['primary'],
  accent: ['accent', 'secondary'],
  akzent: ['accent', 'secondary'],
  hintergrund: ['background', 'surface'],
  bg: ['background', 'surface'],
  text: ['foreground', 'ink', 'text'],
  schrift: ['foreground', 'font', 'text'],
  fg: ['foreground'],
  fehler: ['destructive', 'error', 'danger'],
  error: ['destructive', 'danger'],
  danger: ['destructive', 'error'],
  rot: ['destructive', 'error', 'red'],
  erfolg: ['success'],
  warnung: ['warning'],
  rand: ['border'],
  rahmen: ['border'],
  linie: ['border'],
  abstand: ['spacing', 'space'],
  ecke: ['radius'],
  rundung: ['radius'],
}

/**
 * When a search finds nothing: the register's own word for it, if there is one (`brand` →
 * `primary`). Only words that would find something are suggested.
 */
export function suggestQuery(rows: readonly { haystack: string }[], query: string): string | undefined {
  const word = query.trim().toLowerCase()
  if (!word || rows.some((r) => r.haystack.includes(word))) return undefined
  return SYNONYMS[word]?.find((s) => s !== word && rows.some((r) => r.haystack.includes(s)))
}

/** Search and type filter of the token table. Every word must match (name, value, alias, variable). */
export function filterRows<R extends { haystack: string }>(
  rows: readonly R[],
  query: string,
  keep: (row: R) => boolean = () => true,
): R[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return rows.filter((r) => keep(r) && words.every((w) => r.haystack.includes(w)))
}

/** `color.brand` → `blue.600` → … until a token holds a value (stops on cycles). */
export function aliasChain(register: Pick<Register, 'tokens'>, path: string): string[] {
  const chain: string[] = []
  let current = register.tokens.get(path)?.aliasOf
  while (current && !chain.includes(current) && chain.length < 16) {
    chain.push(current)
    current = register.tokens.get(current)?.aliasOf
  }
  return chain
}

/** Plain-language reason for an owner, as an i18n key and its values. */
export function ownerReason(source: OwnerSource): { key: string; values: Record<string, string | number> } {
  switch (source.kind) {
    case 'fixed':
      return { key: 'fixed', values: {} }
    case 'token':
      return { key: 'token', values: { file: source.file } }
    case 'group':
      return { key: 'group', values: { group: source.path || '(root)', file: source.file } }
    case 'component':
      return { key: 'component', values: { pattern: source.pattern, file: source.file } }
    case 'rule':
      return { key: 'rule', values: { pattern: source.pattern, index: source.index + 1 } }
    case 'default':
      return { key: 'default', values: {} }
  }
}

export interface OwnerView {
  owner: Owner
  reason: { key: string; values: Record<string, string | number> }
  /** `accord explain-owner` output, for people who want the exact rule. */
  explain: string
}

export function ownerView(register: Register, path: string): OwnerView {
  const { owner, source } = resolveOwner(register, path)
  return { owner, reason: ownerReason(source), explain: explainOwner(register, path) }
}

/** Active decisions whose scope covers a register path, plus those the entry names itself. */
export function decisionsFor(register: Pick<Register, 'decisions'>, path: string, named: string[] = []) {
  return [...register.decisions.values()].filter(
    (d) => d.status === 'active' && (named.includes(d.id) || d.scope.some((s) => matchPath(s, path))),
  )
}

/** What the code scan knows about a token. */
export interface CodeUse {
  /** References of the token's CSS variable in the scanned code. */
  uses: number
  /** `defined`: the CSS defines the variable, but no source files were scanned to count uses. */
  status: 'drift' | 'missing' | 'used' | 'unused' | 'defined'
  /** Register and code values when they differ. */
  drift?: { register?: string | undefined; code?: string | undefined } | undefined
  /** Hard-coded values that should be this token (exact match), first few. */
  hardValues: { file: string; line: number; raw: string }[]
  hardValueCount: number
}

/** The bits of the drift report the inspector needs (structurally typed, so tests need no full report). */
export interface CodeReportLike {
  filesScanned: number
  tokensCovered: number
  missing: string[]
  drift: { path: string; register?: string | undefined; surface?: string | undefined }[]
  hardValues: { file: string; line: number; raw: string; replacement?: string | undefined }[]
  tokenUsage?: Record<string, number> | undefined
}

export function codeUseOf(report: CodeReportLike | undefined, path: string): CodeUse | undefined {
  if (!report || (report.filesScanned === 0 && report.tokensCovered === 0)) return undefined
  const uses = report.tokenUsage?.[path] ?? 0
  const drift = report.drift.find((d) => d.path === path || d.path === `tokens.${path}`)
  const hard = report.hardValues.filter((h) => h.replacement === path)
  const counted = report.filesScanned > 0
  return {
    uses,
    status: drift
      ? 'drift'
      : report.missing.includes(path)
        ? 'missing'
        : !counted
          ? 'defined'
          : uses > 0
            ? 'used'
            : 'unused',
    drift: drift ? { register: drift.register, code: drift.surface } : undefined,
    hardValues: hard.slice(0, 5).map((h) => ({ file: h.file, line: h.line, raw: h.raw })),
    hardValueCount: hard.length,
  }
}

// --- Components -----------------------------------------------------------------------------------

export type CodeLink = 'inSync' | 'missing' | 'noMapping'

export interface ComponentRow {
  name: string
  status: 'draft' | 'stable' | 'deprecated'
  description?: string | undefined
  variants: { axis: string; options: string[] }[]
  /** Variant combinations, counted the way Figma counts a component set (product of the axes). */
  variantCount: number
  props: number
  /** The code file the contract maps to (`components/ui/button.tsx`). */
  file?: string | undefined
  code: CodeLink
  surfaces: { figma: boolean; pen: boolean; claudeDesign: boolean }
  haystack: string
}

export function componentRow(
  c: Register['components'] extends Map<string, infer C> ? C : never,
  code: CodeLink,
): ComponentRow {
  const variants = Object.entries(c.variants).map(([axis, options]) => ({ axis, options }))
  return {
    name: c.name,
    status: c.status,
    description: c.description,
    variants,
    variantCount: variants.length === 0 ? 0 : variants.reduce((n, v) => n * Math.max(1, v.options.length), 1),
    props: Object.keys(c.props).length,
    file: c.mappings.code?.path,
    code,
    surfaces: {
      figma: Boolean(c.mappings.figma),
      pen: Boolean(c.mappings.pen),
      claudeDesign: Boolean(c.mappings.claude_design),
    },
    haystack: [
      c.name,
      c.description ?? '',
      ...variants.flatMap((v) => [v.axis, ...v.options]),
      ...Object.keys(c.props),
      c.mappings.code?.path ?? '',
    ]
      .join(' ')
      .toLowerCase(),
  }
}

/** Anatomy as a layer tree: a leading `root` holds the other parts, like Figma's layers panel. */
export function anatomyTree(parts: readonly string[]): { name: string; depth: number }[] {
  const nested = parts[0] === 'root' && parts.length > 1
  return parts.map((name, i) => ({ name, depth: nested && i > 0 ? 1 : 0 }))
}

// --- Decisions ------------------------------------------------------------------------------------

/**
 * A decision's scope pattern in plain words, as an i18n key under `register.decisions.scopeLabel`:
 * `tokens.**` → all tokens, `code:src/**\/*.{ts,tsx}` → code files under `src/`. Anything else is
 * shown as the pattern itself.
 */
export function scopeLabel(pattern: string): { key: string; values: Record<string, string> } {
  if (pattern === 'tokens' || pattern === 'tokens.**') return { key: 'allTokens', values: {} }
  if (pattern === 'components' || pattern === 'components.**') return { key: 'allComponents', values: {} }
  const group = /^tokens\.([^*{}]+)\.\*\*$/.exec(pattern)
  if (group?.[1]) return { key: 'tokenGroup', values: { group: group[1] } }
  const code = /^code:(?:\.\/)?([^*{}?]*?)\/?\*\*(?:\/[^/]*)?$/.exec(pattern)
  if (code)
    return code[1] ? { key: 'codeDir', values: { dir: `${code[1]}/` } } : { key: 'allCode', values: {} }
  return { key: 'raw', values: { pattern } }
}

/** Why a decision applies to a register path: named by the entry itself, or the scope pattern that matches. */
export function decisionReason(
  decision: Pick<Decision, 'id' | 'scope'>,
  path: string,
  named: readonly string[] = [],
): { kind: 'named' } | { kind: 'pattern'; pattern: string } | undefined {
  if (named.includes(decision.id)) return { kind: 'named' }
  const pattern = decision.scope.find((s) => matchPath(s, path))
  return pattern ? { kind: 'pattern', pattern } : undefined
}

// --- Open proposals -------------------------------------------------------------------------------

/** One open proposal that touches a token, as the register shows it next to the token. */
export interface OpenChange {
  id: string
  tool: 'figma' | 'pen' | 'claude-design' | 'code'
  kind: 'change' | 'new' | 'remove'
  before?: string | undefined
  after?: string | undefined
}

/** Open proposals per token path (decided ones and hard values in code are left out). */
export function openChangesByToken(
  proposals: readonly {
    id: string
    tool: OpenChange['tool']
    group: string
    decidable: boolean
    changes: readonly {
      token: string
      kind: OpenChange['kind']
      before?: string | undefined
      after?: string | undefined
    }[]
  }[],
): Record<string, OpenChange[]> {
  const out: Record<string, OpenChange[]> = {}
  for (const p of proposals) {
    if (!p.decidable || (p.group !== 'needsYou' && p.group !== 'auto')) continue
    for (const c of p.changes) {
      const list = out[c.token] ?? []
      if (!list.some((o) => o.id === p.id))
        list.push({ id: p.id, tool: p.tool, kind: c.kind, before: c.before, after: c.after })
      out[c.token] = list
    }
  }
  return out
}

// --- CSS for tokens that code does not have yet ----------------------------------------------------

/** A token's value as CSS: an alias as `var(--other)`, everything else as the property value. */
function cssValueOf(register: Pick<Register, 'tokens'>, token: Token, cssVar: (t: Token) => string): string {
  const target = token.aliasOf ? register.tokens.get(token.aliasOf) : undefined
  if (target) return `var(${cssVar(target)})`
  const preview = previewOf(token)
  switch (preview.kind) {
    case 'fontWeight':
      return String(preview.weight)
    case 'duration':
      return `${preview.ms}ms`
    case 'easing':
      return `cubic-bezier(${preview.points.join(', ')})`
    case 'none':
      return valueText(token.type, token.value)
    default:
      return preview.css
  }
}

/**
 * The lines a stylesheet needs so that code has a CSS variable for each of these register tokens
 * (`:root { --blue-600: #3c6681; }`), named the way Accord reads them back. Unknown paths are skipped;
 * without any known one there is nothing to copy.
 */
export function missingCss(
  register: Pick<Register, 'tokens'>,
  paths: readonly string[],
  cssVar: (t: Token) => string,
): string | undefined {
  const lines = paths.flatMap((path) => {
    const token = register.tokens.get(path)
    return token ? [`  ${cssVar(token)}: ${cssValueOf(register, token, cssVar)};`] : []
  })
  return lines.length > 0 ? [':root {', ...lines, '}'].join('\n') : undefined
}
