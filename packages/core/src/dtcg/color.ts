import { type Color, converter, differenceCiede2000, formatHex, parse, wcagContrast } from 'culori'
import type { ColorSpace, ColorValue } from './types.js'

type Mode =
  | 'rgb'
  | 'lrgb'
  | 'hsl'
  | 'hwb'
  | 'lab'
  | 'lch'
  | 'oklab'
  | 'oklch'
  | 'p3'
  | 'a98'
  | 'prophoto'
  | 'rec2020'
  | 'xyz65'
  | 'xyz50'

/** DTCG colour space → culori mode, plus the channel names in DTCG component order. */
const SPACES: Record<
  ColorSpace,
  { mode: Mode; channels: [string, string, string]; percent?: [boolean, boolean, boolean] }
> = {
  srgb: { mode: 'rgb', channels: ['r', 'g', 'b'] },
  'srgb-linear': { mode: 'lrgb', channels: ['r', 'g', 'b'] },
  // DTCG expresses HSL/HWB saturation, lightness, whiteness and blackness in [0, 100]; culori in [0, 1].
  hsl: { mode: 'hsl', channels: ['h', 's', 'l'], percent: [false, true, true] },
  hwb: { mode: 'hwb', channels: ['h', 'w', 'b'], percent: [false, true, true] },
  lab: { mode: 'lab', channels: ['l', 'a', 'b'] },
  lch: { mode: 'lch', channels: ['l', 'c', 'h'] },
  oklab: { mode: 'oklab', channels: ['l', 'a', 'b'] },
  oklch: { mode: 'oklch', channels: ['l', 'c', 'h'] },
  'display-p3': { mode: 'p3', channels: ['r', 'g', 'b'] },
  'a98-rgb': { mode: 'a98', channels: ['r', 'g', 'b'] },
  'prophoto-rgb': { mode: 'prophoto', channels: ['r', 'g', 'b'] },
  rec2020: { mode: 'rec2020', channels: ['r', 'g', 'b'] },
  'xyz-d65': { mode: 'xyz65', channels: ['x', 'y', 'z'] },
  'xyz-d50': { mode: 'xyz50', channels: ['x', 'y', 'z'] },
}

const toRgb = converter('rgb')

function toCulori(value: ColorValue): Color {
  const space = SPACES[value.colorSpace]
  const color: Record<string, unknown> = { mode: space.mode }
  value.components.forEach((component, i) => {
    if (component === 'none') return
    const channel = space.channels[i] as string
    color[channel] = space.percent?.[i] ? component / 100 : component
  })
  if (value.alpha !== undefined && value.alpha < 1) color.alpha = value.alpha
  return color as unknown as Color
}

const round = (n: number, digits = 4): number => {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

/** Six-digit lowercase CSS hex of a DTCG colour (alpha is not part of the DTCG hex fallback). */
export function colorToHex(value: ColorValue): string {
  if (value.colorSpace === 'srgb' && value.hex) return value.hex.toLowerCase()
  return formatHex(toCulori(value))
}

export function colorAlpha(value: ColorValue): number {
  return value.alpha ?? 1
}

/** Normalised CSS notation: `#rrggbb`, or `#rrggbbaa` when not fully opaque. */
export function colorToCss(value: ColorValue): string {
  const hex = colorToHex(value)
  const alpha = colorAlpha(value)
  if (alpha >= 1) return hex
  return `${hex}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')}`
}

/** Build a DTCG sRGB colour from any CSS colour string (hex, rgb(), hsl(), oklch(), named …). */
export function cssToColor(css: string): ColorValue | undefined {
  const parsed = parse(css.trim())
  if (!parsed) return undefined
  const rgb = toRgb(parsed)
  const clamp = (n: number | undefined) => Math.min(1, Math.max(0, n ?? 0))
  const r = clamp(rgb.r)
  const g = clamp(rgb.g)
  const b = clamp(rgb.b)
  const result: ColorValue = {
    colorSpace: 'srgb',
    components: [round(r), round(g), round(b)],
    hex: formatHex({ mode: 'rgb', r, g, b }),
  }
  if (rgb.alpha !== undefined && rgb.alpha < 1) result.alpha = round(rgb.alpha, 3)
  return result
}

/** CIEDE2000 distance. Below ~1 is invisible, below ~2.3 a "just noticeable difference". */
export function deltaE(a: ColorValue, b: ColorValue): number {
  return differenceCiede2000()(toCulori(a), toCulori(b))
}

/** WCAG 2.x contrast ratio, e.g. 4.5 for AA body text. */
export function contrastRatio(a: ColorValue, b: ColorValue): number {
  return wcagContrast(toCulori(a), toCulori(b))
}
