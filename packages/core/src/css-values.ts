import { cssToColor } from './dtcg/color.js'
import type { ColorValue, DimensionValue, DurationValue } from './dtcg/types.js'

/** Split a CSS value on top-level separators, ignoring those inside parentheses. */
export function splitTopLevel(value: string, separator: ',' | ' '): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of value) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    const isSeparator = separator === ' ' ? /\s/.test(ch) : ch === separator
    if (isSeparator && depth === 0) {
      if (current.trim()) parts.push(current.trim())
      current = ''
    } else current += ch
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

/** `24px`, `1.5rem`, `0` → DTCG dimension. Other units cannot be expressed in DTCG and return undefined. */
export function cssToDimension(css: string): DimensionValue | undefined {
  const value = css.trim()
  if (/^-?0+(\.0+)?$/.test(value)) return { value: 0, unit: 'px' }
  const match = /^(-?\d*\.?\d+)(px|rem)$/.exec(value)
  if (match) return { value: Number(match[1]), unit: match[2] as 'px' | 'rem' }
  if (/^calc\(/i.test(value)) return evaluateCalc(value)
  return undefined
}

type Quantity = { value: number; unit: 'px' | 'rem' | '' }

/**
 * Evaluate simple `calc()` expressions over px/rem and plain numbers, e.g. `calc(0.625rem * 0.6)`
 * (shadcn radius scale). Mixed units, percentages and viewport units are not resolvable and return undefined.
 */
export function evaluateCalc(css: string): DimensionValue | undefined {
  const expression = css.trim().replace(/^calc/i, '')
  const tokens = expression.match(/-?\d*\.?\d+(?:px|rem)?|[()*/+-]/g)
  // Anything the tokenizer skipped (%, vw, var(), …) makes the expression unresolvable.
  if (!tokens || tokens.join('') !== expression.replace(/\s+/g, '')) return undefined
  let pos = 0
  const peek = () => tokens[pos]
  const next = () => tokens[pos++]

  const primary = (): Quantity | undefined => {
    const t = next()
    if (t === '(') {
      const inner = sum()
      return next() === ')' ? inner : undefined
    }
    const m = t ? /^(-?\d*\.?\d+)(px|rem)?$/.exec(t) : null
    return m ? { value: Number(m[1]), unit: (m[2] as 'px' | 'rem' | undefined) ?? '' } : undefined
  }
  const product = (): Quantity | undefined => {
    let left = primary()
    while (left && (peek() === '*' || peek() === '/')) {
      const op = next()
      const right = primary()
      if (!right) return undefined
      if (op === '*') {
        if (left.unit && right.unit) return undefined
        left = { value: left.value * right.value, unit: left.unit || right.unit }
      } else {
        if (right.unit || right.value === 0) return undefined
        left = { value: left.value / right.value, unit: left.unit }
      }
    }
    return left
  }
  const sum = (): Quantity | undefined => {
    let left = product()
    while (left && (peek() === '+' || peek() === '-')) {
      const op = next()
      const right = product()
      if (!right || left.unit !== right.unit) return undefined
      left = { value: op === '+' ? left.value + right.value : left.value - right.value, unit: left.unit }
    }
    return left
  }

  const result = sum()
  if (!result || pos !== tokens.length || result.unit === '') return undefined
  return { value: Math.round(result.value * 10000) / 10000, unit: result.unit }
}

export function cssToDuration(css: string): DurationValue | undefined {
  const match = /^(\d*\.?\d+)(ms|s)$/.exec(css.trim())
  if (!match) return undefined
  return { value: Number(match[1]), unit: match[2] as 'ms' | 's' }
}

export function dimensionToCss(d: DimensionValue): string {
  return d.value === 0 ? '0' : `${d.value}${d.unit}`
}

/** Dimension in px, assuming a 16px root, for comparing values across units. */
export function dimensionToPx(d: DimensionValue, rootPx = 16): number {
  return d.unit === 'rem' ? d.value * rootPx : d.value
}

export interface ShadowLayer {
  color: ColorValue
  offsetX: DimensionValue
  offsetY: DimensionValue
  blur: DimensionValue
  spread: DimensionValue
  inset?: boolean
}

/** `0 1px 3px rgba(0,0,0,.04), inset 0 0 0 1px #fff` → DTCG shadow layers. Undefined if any layer is not understood. */
export function cssToShadow(css: string): ShadowLayer[] | undefined {
  const layers: ShadowLayer[] = []
  for (const layer of splitTopLevel(css, ',')) {
    let inset = false
    let color: ColorValue | undefined
    const lengths: DimensionValue[] = []
    for (const part of splitTopLevel(layer, ' ')) {
      if (part === 'inset') {
        inset = true
        continue
      }
      const length = cssToDimension(part)
      if (length) {
        lengths.push(length)
        continue
      }
      const parsed = cssToColor(part)
      if (!parsed || color) return undefined
      color = parsed
    }
    if (lengths.length < 2 || lengths.length > 4) return undefined
    const zero: DimensionValue = { value: 0, unit: 'px' }
    const out: ShadowLayer = {
      color: color ?? (cssToColor('#000000') as ColorValue),
      offsetX: lengths[0] as DimensionValue,
      offsetY: lengths[1] as DimensionValue,
      blur: lengths[2] ?? zero,
      spread: lengths[3] ?? zero,
    }
    if (inset) out.inset = true
    layers.push(out)
  }
  return layers.length > 0 ? layers : undefined
}
