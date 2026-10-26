import { COLOR_SPACES, FONT_WEIGHT_ALIASES, STROKE_STYLES, TOKEN_TYPES, type TokenType } from './types.js'

/** Problems with a resolved `$value`, as human-readable messages. Empty means valid. */
export type ValueProblems = string[]

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export const isTokenType = (v: unknown): v is TokenType =>
  typeof v === 'string' && (TOKEN_TYPES as readonly string[]).includes(v)

function color(v: unknown, at: string, out: ValueProblems): void {
  if (typeof v === 'string') {
    out.push(`${at}: colour must be an object { colorSpace, components }, not a string ("${v}")`)
    return
  }
  if (!isObject(v)) return void out.push(`${at}: colour must be an object`)
  if (!(COLOR_SPACES as readonly string[]).includes(v.colorSpace as string)) {
    out.push(`${at}.colorSpace: unknown colour space "${String(v.colorSpace)}"`)
  }
  const c = v.components
  if (!Array.isArray(c) || c.length !== 3 || !c.every((x) => isNumber(x) || x === 'none')) {
    out.push(`${at}.components: must be an array of three numbers or "none"`)
  } else if (
    ['srgb', 'srgb-linear', 'display-p3', 'a98-rgb', 'prophoto-rgb', 'rec2020'].includes(
      v.colorSpace as string,
    )
  ) {
    if (c.some((x) => isNumber(x) && (x < 0 || x > 1)))
      out.push(`${at}.components: RGB components must be in [0, 1]`)
  }
  if (v.alpha !== undefined && (!isNumber(v.alpha) || v.alpha < 0 || v.alpha > 1)) {
    out.push(`${at}.alpha: must be a number in [0, 1]`)
  }
  if (v.hex !== undefined && (typeof v.hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v.hex))) {
    out.push(`${at}.hex: must be six-digit CSS hex, e.g. #3c6681`)
  }
}

function dimension(v: unknown, at: string, out: ValueProblems): void {
  if (!isObject(v) || !isNumber(v.value) || (v.unit !== 'px' && v.unit !== 'rem')) {
    out.push(`${at}: dimension must be { value: number, unit: "px" | "rem" }`)
  }
}

function duration(v: unknown, at: string, out: ValueProblems): void {
  if (!isObject(v) || !isNumber(v.value) || (v.unit !== 'ms' && v.unit !== 's')) {
    out.push(`${at}: duration must be { value: number, unit: "ms" | "s" }`)
  }
}

function fontFamily(v: unknown, at: string, out: ValueProblems): void {
  const ok =
    typeof v === 'string' || (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string'))
  if (!ok) out.push(`${at}: fontFamily must be a string or a non-empty array of strings`)
}

function fontWeight(v: unknown, at: string, out: ValueProblems): void {
  if (isNumber(v)) {
    if (v < 1 || v > 1000) out.push(`${at}: fontWeight must be in [1, 1000]`)
  } else if (typeof v !== 'string' || !(v in FONT_WEIGHT_ALIASES)) {
    out.push(`${at}: fontWeight must be a number or a predefined alias such as "bold"`)
  }
}

function cubicBezier(v: unknown, at: string, out: ValueProblems): void {
  if (!Array.isArray(v) || v.length !== 4 || !v.every(isNumber)) {
    return void out.push(`${at}: cubicBezier must be an array of four numbers`)
  }
  if ((v[0] as number) < 0 || (v[0] as number) > 1 || (v[2] as number) < 0 || (v[2] as number) > 1) {
    out.push(`${at}: cubicBezier x coordinates must be in [0, 1]`)
  }
}

function strokeStyle(v: unknown, at: string, out: ValueProblems): void {
  if (typeof v === 'string') {
    if (!(STROKE_STYLES as readonly string[]).includes(v)) out.push(`${at}: unknown strokeStyle "${v}"`)
    return
  }
  if (
    !isObject(v) ||
    !Array.isArray(v.dashArray) ||
    !['round', 'butt', 'square'].includes(v.lineCap as string)
  ) {
    return void out.push(`${at}: strokeStyle object must be { dashArray: dimension[], lineCap }`)
  }
  v.dashArray.forEach((d, i) => {
    dimension(d, `${at}.dashArray[${i}]`, out)
  })
}

function shadowLayer(v: unknown, at: string, out: ValueProblems): void {
  if (!isObject(v)) return void out.push(`${at}: shadow must be an object`)
  color(v.color, `${at}.color`, out)
  for (const key of ['offsetX', 'offsetY', 'blur', 'spread'] as const) dimension(v[key], `${at}.${key}`, out)
  if (v.inset !== undefined && typeof v.inset !== 'boolean') out.push(`${at}.inset: must be a boolean`)
}

const validators: Record<TokenType, (v: unknown, at: string, out: ValueProblems) => void> = {
  color,
  dimension,
  duration,
  fontFamily,
  fontWeight,
  cubicBezier,
  strokeStyle,
  number: (v, at, out) => {
    if (!isNumber(v)) out.push(`${at}: must be a number`)
  },
  border: (v, at, out) => {
    if (!isObject(v)) return void out.push(`${at}: border must be { color, width, style }`)
    color(v.color, `${at}.color`, out)
    dimension(v.width, `${at}.width`, out)
    strokeStyle(v.style, `${at}.style`, out)
  },
  transition: (v, at, out) => {
    if (!isObject(v)) return void out.push(`${at}: transition must be { duration, delay, timingFunction }`)
    duration(v.duration, `${at}.duration`, out)
    duration(v.delay, `${at}.delay`, out)
    cubicBezier(v.timingFunction, `${at}.timingFunction`, out)
  },
  shadow: (v, at, out) => {
    if (Array.isArray(v)) {
      v.forEach((layer, i) => {
        shadowLayer(layer, `${at}[${i}]`, out)
      })
    } else shadowLayer(v, at, out)
  },
  gradient: (v, at, out) => {
    if (!Array.isArray(v)) return void out.push(`${at}: gradient must be an array of stops`)
    for (const [i, stop] of v.entries()) {
      if (!isObject(stop)) {
        out.push(`${at}[${i}]: gradient stop must be { color, position }`)
        continue
      }
      color(stop.color, `${at}[${i}].color`, out)
      if (!isNumber(stop.position)) out.push(`${at}[${i}].position: must be a number`)
    }
  },
  typography: (v, at, out) => {
    if (!isObject(v)) {
      return void out.push(
        `${at}: typography must be { fontFamily, fontSize, fontWeight, letterSpacing, lineHeight }`,
      )
    }
    fontFamily(v.fontFamily, `${at}.fontFamily`, out)
    dimension(v.fontSize, `${at}.fontSize`, out)
    fontWeight(v.fontWeight, `${at}.fontWeight`, out)
    dimension(v.letterSpacing, `${at}.letterSpacing`, out)
    if (!isNumber(v.lineHeight)) out.push(`${at}.lineHeight: must be a number (multiplier of fontSize)`)
  },
}

export function validateValue(type: TokenType, value: unknown): ValueProblems {
  const out: ValueProblems = []
  validators[type](value, '$value', out)
  return out
}
