import { cssToDimension, cssToShadow, splitTopLevel } from '../css-values.js'
import { cssToColor } from '../dtcg/color.js'
import { parseTokens, type TokenFile } from '../dtcg/parse.js'
import {
  ACCORD_EXTENSION_KEY,
  type DimensionValue,
  FONT_WEIGHT_ALIASES,
  type TokenType,
} from '../dtcg/types.js'
import type { Issue } from '../issues.js'

/**
 * Import a Tokens Studio (legacy `value`/`type`) export into DTCG 2025.10.
 *
 * - Token sets (top-level keys) are merged; `$themes` and `$metadata` are ignored.
 * - Tailwind-style `DEFAULT` keys become DTCG `$root` tokens, references are rewritten accordingly.
 * - Values DTCG cannot express (fluid `clamp()` sizes, `em`, math) are approximated where possible,
 *   the exact CSS is kept under `$extensions["de.decivo.accord"].css`, and a warning is reported.
 * - Output: one file per top-level group (`tokens/color.tokens.json`, …), validated with the DTCG parser.
 */
export interface TokensStudioImport {
  files: TokenFile[]
  issues: Issue[]
  /** Tokens Studio path → DTCG path, e.g. `color.brand.DEFAULT` → `color.brand.$root`. */
  renamed: Map<string, string>
}

type Obj = Record<string, unknown>
const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Tokens Studio type names and the DTCG type each becomes. */
export const TOKENS_STUDIO_TYPES: Record<string, TokenType> = {
  color: 'color',
  borderRadius: 'dimension',
  borderWidth: 'dimension',
  sizing: 'dimension',
  spacing: 'dimension',
  dimension: 'dimension',
  fontSizes: 'dimension',
  letterSpacing: 'dimension',
  paragraphSpacing: 'dimension',
  fontFamilies: 'fontFamily',
  fontWeights: 'fontWeight',
  lineHeights: 'number',
  opacity: 'number',
  number: 'number',
  boxShadow: 'shadow',
  typography: 'typography',
  duration: 'duration',
}

const SKIPPED_TOP_LEVEL = new Set(['$schema', '$themes', '$metadata'])
const CONTAINS_REFERENCE = /\{[^{}]+\}/

const dtcgName = (key: string) => (key === 'DEFAULT' ? '$root' : key)
const rewriteRef = (ref: string) =>
  ref
    .split('.')
    .map((seg) => dtcgName(seg))
    .join('.')

export function importTokensStudio(json: unknown, source = 'tokens.json'): TokensStudioImport {
  const issues: Issue[] = []
  const renamed = new Map<string, string>()
  const warn = (path: string, message: string, code = 'import-approximated') =>
    issues.push({ severity: 'warning', code, file: source, path, message })

  if (!isObject(json)) {
    return {
      files: [],
      renamed,
      issues: [{ severity: 'error', code: 'import', file: source, message: 'expected a JSON object' }],
    }
  }

  // Merge token sets.
  const merged: Obj = {}
  // Multi-set exports list their sets in $metadata.tokenSetOrder; single-set exports
  // from Tokens Studio name the only set "global". Otherwise the file is one token tree.
  const entries = Object.entries(json).filter(([key]) => !SKIPPED_TOP_LEVEL.has(key))
  const metadata = json.$metadata
  const order =
    isObject(metadata) && Array.isArray(metadata.tokenSetOrder)
      ? (metadata.tokenSetOrder as string[])
      : undefined
  const sets: [string, unknown][] = order
    ? order.filter((name) => name in json).map((name) => [name, json[name]])
    : 'global' in json
      ? entries
      : [['', Object.fromEntries(entries)]]
  for (const [setName, set] of sets) {
    if (!isObject(set)) continue
    mergeDeep(merged, set, setName, issues, source)
  }

  /** Convert one Tokens Studio leaf; returns a DTCG token object or undefined if it must be dropped. */
  const convert = (node: Obj, path: string): Obj | undefined => {
    const tsType = String(node.type ?? '')
    const type = TOKENS_STUDIO_TYPES[tsType]
    if (!type) {
      warn(path, `type "${tsType}" has no DTCG equivalent; token skipped`, 'import-unsupported')
      return undefined
    }
    const out: Obj = { $type: type }
    const accord: Obj = {}
    const raw = node.value

    if (typeof raw === 'string' && /^\{[^{}]+\}$/.test(raw.trim())) {
      out.$value = `{${rewriteRef(raw.trim().slice(1, -1))}}`
    } else if (typeof raw === 'string' && CONTAINS_REFERENCE.test(raw)) {
      warn(
        path,
        `math or partial reference "${raw}" is not supported in DTCG; token skipped`,
        'import-unsupported',
      )
      return undefined
    } else {
      const value = convertValue(type, raw, path, accord, warn)
      if (value === undefined) return undefined
      out.$value = value
    }
    if (typeof node.description === 'string' && node.description) out.$description = node.description
    if (Object.keys(accord).length > 0) out.$extensions = { [ACCORD_EXTENSION_KEY]: accord }
    return out
  }

  const walk = (node: Obj, segs: string[]): Obj => {
    const out: Obj = {}
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith('$') || !isObject(child)) continue
      const name = dtcgName(key)
      const tsPath = [...segs, key].join('.')
      const dtcgPath = [...segs.map(dtcgName), name].join('.')
      if (name !== key) renamed.set(tsPath, dtcgPath)
      if ('value' in child) {
        const token = convert(child, tsPath)
        if (token) out[name] = token
      } else if (name === '$root') {
        warn(tsPath, 'DEFAULT is a group, not a token; skipped', 'import-unsupported')
      } else {
        const group = walk(child, [...segs, key])
        if (Object.keys(group).length > 0) out[name] = group
      }
    }
    return out
  }

  const converted = walk(merged, [])

  // Hoist a shared $type to the group so files read like hand-written DTCG.
  const hoist = (group: Obj): TokenType | undefined => {
    const types = new Set<TokenType | undefined>()
    for (const [key, child] of Object.entries(group)) {
      if (key.startsWith('$') && key !== '$root') continue
      if (!isObject(child)) continue
      types.add('$value' in child ? (child.$type as TokenType) : hoist(child))
    }
    if (types.size !== 1) return undefined
    const [type] = types
    if (!type) return undefined
    // Rebuild so $type comes first, like hand-written DTCG.
    const children = Object.entries(group)
    for (const [key] of children) delete group[key]
    group.$type = type
    for (const [key, child] of children) group[key] = child
    const strip = (g: Obj) => {
      for (const [key, child] of Object.entries(g)) {
        if (!isObject(child) || (key.startsWith('$') && key !== '$root')) continue
        if ('$value' in child) delete child.$type
        else {
          delete child.$type
          strip(child)
        }
      }
    }
    strip(group)
    return type
  }

  const files: TokenFile[] = []
  for (const [name, group] of Object.entries(converted)) {
    if (!isObject(group)) continue
    if ('$value' in group) {
      files.push({ file: `tokens/${name}.tokens.json`, content: { [name]: group } })
      continue
    }
    hoist(group)
    files.push({ file: `tokens/${name}.tokens.json`, content: { [name]: group } })
  }

  // Validate the result with the real parser so broken references surface here, not later.
  issues.push(...parseTokens(files).issues)
  return { files, issues, renamed }
}

function mergeDeep(
  target: Obj,
  source: Obj,
  setName: string,
  issues: Issue[],
  file: string,
  segs: string[] = [],
): void {
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith('$')) continue
    const path = [...segs, key].join('.')
    if (!isObject(value)) continue
    if ('value' in value) {
      if (target[key] !== undefined) {
        issues.push({
          severity: 'error',
          code: 'import-duplicate',
          file,
          path,
          message: `defined in more than one set (again in "${setName}")`,
        })
        continue
      }
      target[key] = value
    } else {
      if (!isObject(target[key])) target[key] = {}
      mergeDeep(target[key] as Obj, value, setName, issues, file, [...segs, key])
    }
  }
}

/** Largest rem/px length inside a CSS expression such as `clamp(2.5rem, 5vw, 3.5rem)`. */
function largestLength(css: string): DimensionValue | undefined {
  const lengths = [...css.matchAll(/(-?\d*\.?\d+)(px|rem)\b/g)].map((m) => ({
    value: Number(m[1]),
    unit: m[2] as 'px' | 'rem',
  }))
  const px = (d: DimensionValue) => (d.unit === 'rem' ? d.value * 16 : d.value)
  return lengths.sort((a, b) => px(b) - px(a))[0]
}

function dimensionValue(
  raw: unknown,
  path: string,
  accord: Obj,
  warn: (p: string, m: string) => void,
): DimensionValue | undefined {
  if (typeof raw === 'number') return { value: raw, unit: 'px' }
  const css = String(raw).trim()
  const exact = cssToDimension(css)
  if (exact) return exact
  const approx = largestLength(css)
  if (approx) {
    accord.css = css
    warn(
      path,
      `"${css}" is not a fixed px/rem value; using ${approx.value}${approx.unit} and keeping the CSS in $extensions`,
    )
    return approx
  }
  warn(path, `"${css}" cannot be expressed as a DTCG dimension; token skipped`)
  return undefined
}

function convertValue(
  type: TokenType,
  raw: unknown,
  path: string,
  accord: Obj,
  warn: (p: string, m: string, code?: string) => void,
): unknown {
  switch (type) {
    case 'color': {
      const color = cssToColor(String(raw))
      if (!color) warn(path, `"${String(raw)}" is not a colour; token skipped`, 'import-unsupported')
      return color
    }
    case 'dimension':
      return dimensionValue(raw, path, accord, warn)
    case 'duration': {
      const match = /^(\d*\.?\d+)(ms|s)$/.exec(String(raw).trim())
      if (!match)
        return void warn(path, `"${String(raw)}" is not a duration; token skipped`, 'import-unsupported')
      return { value: Number(match[1]), unit: match[2] }
    }
    case 'fontFamily': {
      const families = splitTopLevel(String(raw), ',').map((f) => f.replace(/^['"]|['"]$/g, ''))
      return families.length === 1 ? families[0] : families
    }
    case 'fontWeight': {
      const text = String(raw).trim().toLowerCase()
      if (/^\d+$/.test(text)) return Number(text)
      if (text in FONT_WEIGHT_ALIASES) return text
      return void warn(
        path,
        `font weight "${String(raw)}" not understood; token skipped`,
        'import-unsupported',
      )
    }
    case 'number': {
      const n = Number(String(raw).replace(/%$/, ''))
      if (Number.isNaN(n))
        return void warn(path, `"${String(raw)}" is not a number; token skipped`, 'import-unsupported')
      return String(raw).endsWith('%') ? n / 100 : n
    }
    case 'shadow': {
      const layers = cssToShadow(String(raw))
      if (!layers)
        return void warn(path, `shadow "${String(raw)}" not understood; token skipped`, 'import-unsupported')
      return layers.length === 1 ? layers[0] : layers
    }
    case 'typography': {
      if (!isObject(raw))
        return void warn(path, 'typography must be an object; token skipped', 'import-unsupported')
      const sub: Obj = {}
      const fontSize = dimensionValue(raw.fontSize, `${path}.fontSize`, sub, warn)
      if (!fontSize) return undefined
      if (sub.css) accord.css = { fontSize: sub.css }
      const letterSpacing =
        raw.letterSpacing === undefined ? undefined : cssToDimension(String(raw.letterSpacing))
      if (letterSpacing === undefined) {
        warn(
          path,
          raw.letterSpacing === undefined
            ? 'letterSpacing missing (required in DTCG); set to 0'
            : `letterSpacing "${String(raw.letterSpacing)}" is not px/rem; set to 0`,
        )
      }
      const weight = convertValue('fontWeight', raw.fontWeight ?? 400, `${path}.fontWeight`, accord, warn)
      return {
        fontFamily: convertValue('fontFamily', raw.fontFamily ?? 'sans-serif', path, accord, warn),
        fontSize,
        fontWeight: weight ?? 400,
        letterSpacing: letterSpacing ?? { value: 0, unit: 'px' },
        lineHeight: Number(raw.lineHeight ?? 1.5),
      }
    }
    default:
      return void warn(path, `type ${type} is not imported yet; token skipped`, 'import-unsupported')
  }
}
