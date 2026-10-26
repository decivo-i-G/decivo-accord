/** Types and value shapes from the DTCG Format Module 2025.10 and Color Module 2025.10. */

export const TOKEN_TYPES = [
  'color',
  'dimension',
  'fontFamily',
  'fontWeight',
  'duration',
  'cubicBezier',
  'number',
  'strokeStyle',
  'border',
  'transition',
  'shadow',
  'gradient',
  'typography',
] as const

export type TokenType = (typeof TOKEN_TYPES)[number]

export const COLOR_SPACES = [
  'srgb',
  'srgb-linear',
  'hsl',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'display-p3',
  'a98-rgb',
  'prophoto-rgb',
  'rec2020',
  'xyz-d65',
  'xyz-d50',
] as const

export type ColorSpace = (typeof COLOR_SPACES)[number]

export interface ColorValue {
  colorSpace: ColorSpace
  components: [number | 'none', number | 'none', number | 'none']
  alpha?: number
  hex?: string
}

export interface DimensionValue {
  value: number
  unit: 'px' | 'rem'
}

export interface DurationValue {
  value: number
  unit: 'ms' | 's'
}

export const FONT_WEIGHT_ALIASES: Record<string, number> = {
  thin: 100,
  hairline: 100,
  'extra-light': 200,
  'ultra-light': 200,
  light: 300,
  normal: 400,
  regular: 400,
  book: 400,
  medium: 500,
  'semi-bold': 600,
  'demi-bold': 600,
  bold: 700,
  'extra-bold': 800,
  'ultra-bold': 800,
  black: 900,
  heavy: 900,
  'extra-black': 950,
  'ultra-black': 950,
}

export const STROKE_STYLES = [
  'solid',
  'dashed',
  'dotted',
  'double',
  'groove',
  'ridge',
  'outset',
  'inset',
] as const

/** A raw `$value`, possibly containing curly-brace aliases or `{ "$ref": "#/…" }` pointers. */
export type RawValue = unknown

export const ACCORD_EXTENSION_KEY = 'de.decivo.accord'

export type Owner = 'design' | 'code' | 'register'
export const OWNERS: readonly Owner[] = ['design', 'code', 'register']

/** Accord's own metadata under `$extensions["de.decivo.accord"]`. */
export interface AccordExtension {
  owner?: Owner
  decisions?: string[]
  /** How the token is called on each surface, when it differs from the naming convention. */
  ids?: {
    /** CSS custom property in code, e.g. `--brand-blue`. Default: `--color-brand-600` for `color.brand.600`. */
    css?: string
    figma?: string
    claudeDesign?: string
    pen?: string
  }
  /**
   * Exact CSS when DTCG cannot express the value (e.g. a fluid `clamp()` size).
   * `$value` then holds the closest DTCG value and generators emit this instead.
   * For composite types (typography) it maps sub-properties to CSS, e.g. { fontSize: "clamp(…)" }.
   */
  css?: string | Record<string, string>
}

export interface Token {
  /** Dot path without the `tokens.` prefix, e.g. `color.brand.700`. A group root token ends in `.$root`. */
  path: string
  type: TokenType
  /** `$value` exactly as written in the file. */
  rawValue: RawValue
  /** `$value` with all references resolved. Undefined when resolution failed. */
  value: unknown
  /** Path of the token this one aliases, if its whole `$value` is a curly-brace reference. */
  aliasOf?: string
  description?: string
  deprecated?: boolean | string
  /** All `$extensions`, including unknown vendors (must be preserved on write). */
  extensions?: Record<string, unknown>
  accord?: AccordExtension
  /** Set when the token was copied in through a group's `$extends`; the value is the original token path. */
  inheritedFrom?: string
  file: string
}

export interface Group {
  /** Dot path without the `tokens.` prefix. The root group of a file has path ''. */
  path: string
  /** The group's own `$type`. */
  type?: TokenType
  /** Type its tokens inherit: own `$type`, else from `$extends` or the closest parent group. */
  effectiveType?: TokenType
  description?: string
  deprecated?: boolean | string
  extensions?: Record<string, unknown>
  accord?: AccordExtension
  /** Raw `$extends` reference, kept so the document can be written back unchanged. */
  extends?: string
  /** Set when the whole group was copied in through a parent's `$extends`. */
  inherited?: boolean
  file: string
}
