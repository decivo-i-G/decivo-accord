import { cssToDimension, cssToDuration, cssToShadow } from '../css-values.js'
import { cssToColor } from '../dtcg/color.js'
import { FONT_WEIGHT_ALIASES, type TokenType } from '../dtcg/types.js'

type Obj = Record<string, unknown>
const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const REF = /^\{[^{}]+\}$/

/** A value in the older DTCG draft notation (CSS strings, bare numbers) as a DTCG 2025.10 value; undefined if it cannot be. */
function upgrade(type: string | undefined, value: unknown): unknown {
  if (typeof value === 'string' && REF.test(value)) return value
  switch (type as TokenType | undefined) {
    case 'color':
      return typeof value === 'string' ? cssToColor(value) : value
    case 'dimension':
      if (typeof value === 'number') return { value, unit: 'px' }
      return typeof value === 'string' ? cssToDimension(value) : value
    case 'duration':
      if (typeof value === 'number') return { value, unit: 'ms' }
      return typeof value === 'string' ? cssToDuration(value) : value
    case 'fontWeight':
      if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
      if (typeof value === 'string')
        return FONT_WEIGHT_ALIASES[value.toLowerCase().replace(/\s+/g, '-')] ?? value
      return value
    case 'number':
      return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))
        ? Number(value)
        : value
    case 'shadow':
      return typeof value === 'string' ? cssToShadow(value) : value
    case 'cubicBezier':
      return typeof value === 'string' ? cssToCubicBezier(value) : value
    default:
      return value
  }
}

const EASINGS: Record<string, number[]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
}

/** `cubic-bezier(0.4, 0, 0.2, 1)`, `[0.4, 0, 0.2, 1]` or a CSS easing keyword as a DTCG cubicBezier. */
function cssToCubicBezier(text: string): number[] | undefined {
  const t = text.trim().toLowerCase()
  if (EASINGS[t]) return EASINGS[t]
  const inner = t.match(/^cubic-bezier\((.*)\)$/)?.[1] ?? t.match(/^\[(.*)\]$/)?.[1]
  const numbers = inner?.split(',').map((n) => Number(n.trim()))
  return numbers?.length === 4 && numbers.every((n) => Number.isFinite(n)) ? numbers : undefined
}

const figmaScopes = (node: Obj): unknown[] => {
  const ext = isObject(node.$extensions) ? node.$extensions : {}
  const scopes = ext['com.figma.scopes']
  return Array.isArray(scopes) ? scopes : []
}

/**
 * Upgrade a DTCG file written in the older draft notation (`"$value": "#fff"`, `"16px"`, `200`) to DTCG
 * 2025.10 in place, as most real token files still are. Values that cannot be upgraded are left as they
 * are, so the parser reports them. Returns the number of values changed.
 */
export function upgradeLegacyDtcg(doc: unknown): number {
  let changed = 0
  const walk = (node: Obj, inherited: string | undefined) => {
    const type = typeof node.$type === 'string' ? node.$type : inherited
    if ('$value' in node) {
      // Untyped colour strings are common in old files; type them so the register can hold them.
      if (
        !type &&
        typeof node.$value === 'string' &&
        /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(node.$value)
      ) {
        node.$type = 'color'
        return walk(node, 'color')
      }
      // Figma's export types text variables as "string"; those scoped to font families are fontFamily tokens.
      if (type === 'string' && figmaScopes(node).includes('FONT_FAMILY')) {
        node.$type = 'fontFamily'
        changed++
        return
      }
      if (type === 'string' && figmaScopes(node).includes('FONT_WEIGHT')) {
        const weight = upgrade('fontWeight', node.$value)
        if (typeof weight === 'number') {
          node.$type = 'fontWeight'
          node.$value = weight
          changed++
        }
        return
      }
      const next = upgrade(type, node.$value)
      if (next !== undefined && next !== node.$value) {
        node.$value = next
        changed++
      }
      return
    }
    for (const [key, child] of Object.entries(node))
      if ((!key.startsWith('$') || key === '$root') && isObject(child)) walk(child, type)
  }
  if (isObject(doc)) walk(doc, undefined)
  return changed
}
