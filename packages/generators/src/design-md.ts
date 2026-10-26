import {
  type ColorValue,
  type DimensionValue,
  dimensionToCss,
  FONT_WEIGHT_ALIASES,
  formatValue,
  type Register,
  type Token,
} from '@decivo/accord-core'
import { stringify } from 'yaml'
import {
  type ContextOutput,
  contextOutputs,
  GENERATED_NOTICE,
  type GeneratorRegister,
  ownTokens,
  valueToCss,
} from './values.js'

/** Marker that identifies a DESIGN.md as generated, so Accord never overwrites a hand-written one. */
export const DESIGN_MD_MARKER = '<!-- accord:generated'

type Obj = Record<string, unknown>

const SECTION_PREFIXES = new Set([
  'color',
  'colors',
  'radius',
  'rounded',
  'spacing',
  'space',
  'shadow',
  'shadows',
  'typography',
  'type',
])

/** `color.brand.600` → `brand-600`, `color.brand.$root` → `brand`. */
export function designMdName(path: string): string {
  const segs = path.split('.').filter((s) => s !== '$root')
  const rest = SECTION_PREFIXES.has(segs[0] as string) && segs.length > 1 ? segs.slice(1) : segs
  return rest.join('-')
}

const isRadius = (t: Token) => t.type === 'dimension' && /radius|rounded|corner/.test(t.path)
const isSpacing = (t: Token) =>
  t.type === 'dimension' && !isRadius(t) && /^(spacing|space|gap|size|layout)\b/.test(t.path)

function uniqueNames(tokens: Token[]): Map<Token, string> {
  const names = new Map<Token, string>()
  const used = new Map<string, number>()
  for (const t of tokens) used.set(designMdName(t.path), (used.get(designMdName(t.path)) ?? 0) + 1)
  for (const t of tokens) {
    const short = designMdName(t.path)
    names.set(t, (used.get(short) ?? 0) > 1 ? t.path.replace(/\.\$root$/, '').replaceAll('.', '-') : short)
  }
  return names
}

function typographyValue(token: Token): Obj | undefined {
  const v = token.value as Obj | undefined
  if (!v) return undefined
  const family = Array.isArray(v.fontFamily) ? v.fontFamily[0] : v.fontFamily
  const weight = typeof v.fontWeight === 'string' ? (FONT_WEIGHT_ALIASES[v.fontWeight] ?? 400) : v.fontWeight
  const out: Obj = {
    fontFamily: family,
    // The spec only knows px/em/rem; a fluid size keeps its upper bound here and the exact CSS in the prose.
    fontSize: dimensionToCss(v.fontSize as DimensionValue),
    fontWeight: weight,
    lineHeight: v.lineHeight,
  }
  const letterSpacing = v.letterSpacing as DimensionValue | undefined
  if (letterSpacing && letterSpacing.value !== 0) out.letterSpacing = dimensionToCss(letterSpacing)
  return out
}

const css = (token: Token) => valueToCss(token) ?? formatValue(token.type, token.value)

/** Prose line for a token: name, value (and its value in every context where it differs), description. */
const line = (name: string, token: Token, contexts: readonly ContextOutput[] = []) => {
  const others = contexts.flatMap((c) => {
    const there = c.byPath.get(token.path)
    return there ? [`; ${c.context}: \`${css(there)}\``] : []
  })
  return `- **${name}** (\`${css(token)}\`${others.join('')})${token.description ? `: ${token.description}` : ''}`
}

export interface DesignMdOptions {
  name?: string | undefined
  description?: string | undefined
  fingerprint: string
}

/**
 * DESIGN.md following the Google Labs DESIGN.md format (version alpha): tokens in YAML front matter,
 * rationale in the fixed section order. Decisions become "Do's and Don'ts" with their reasons.
 */
export function generateDesignMd(
  register: Pick<Register, 'tokens' | 'components' | 'decisions'> & GeneratorRegister,
  options: DesignMdOptions,
): string {
  const contexts = contextOutputs(register)
  const tokens = ownTokens(register).filter((t) => t.value !== undefined)
  const colors = tokens.filter((t) => t.type === 'color')
  const typography = tokens.filter((t) => t.type === 'typography')
  const rounded = tokens.filter(isRadius)
  const spacing = tokens.filter(isSpacing)
  const shadows = tokens.filter((t) => t.type === 'shadow')
  const names = uniqueNames([...colors, ...typography, ...rounded, ...spacing, ...shadows])

  const frontMatter: Obj = { version: 'alpha', name: options.name ?? 'Design System' }
  if (options.description) frontMatter.description = options.description
  const omitted: Obj[] = []
  const section = (key: string, list: Token[], value: (t: Token) => unknown) => {
    if (list.length === 0) {
      omitted.push({ section: key, reason: 'No tokens of this kind in the register' })
      return
    }
    const map: Obj = {}
    for (const t of list) {
      const target = t.aliasOf ? register.tokens.get(t.aliasOf) : undefined
      map[names.get(t) as string] = target && names.has(target) ? `{${key}.${names.get(target)}}` : value(t)
    }
    frontMatter[key] = map
  }
  section(
    'colors',
    colors,
    (t) => valueToCss({ type: t.type, value: t.value }) ?? formatValue('color', t.value as ColorValue),
  )
  section('typography', typography, (t) => typographyValue(t))
  section('rounded', rounded, (t) => dimensionToCss(t.value as DimensionValue))
  section('spacing', spacing, (t) => dimensionToCss(t.value as DimensionValue))
  if (omitted.length > 0) frontMatter.omitted = omitted

  const decisions = [...register.decisions.values()].filter((d) => d.status === 'active')
  const components = [...register.components.values()]
  const body: string[] = []
  body.push(`# ${options.name ?? 'Design System'}`, '')
  body.push(`${DESIGN_MD_MARKER} accord:${options.fingerprint} -->`)
  body.push(`> ${GENERATED_NOTICE}`, '')

  body.push('## Overview', '')
  body.push(
    options.description ??
      'The values below are the register’s current decisions. Use the tokens by name; do not copy raw values.',
  )
  body.push('')
  if (register.modes && contexts.length > 0) {
    const where = contexts.map((c) => `${c.context} under \`${c.selector}\``).join(', ')
    body.push(
      `Tokens have a value per context: ${register.modes.default} is the default, ${where}. ` +
        'Where a value differs, the list names it next to the default. Use the variables; they switch with the context.',
    )
    body.push('')
  }

  if (colors.length > 0) {
    body.push('## Colors', '')
    for (const t of colors) body.push(line(names.get(t) as string, t, contexts))
    body.push('')
  }
  if (typography.length > 0) {
    body.push('## Typography', '')
    for (const t of typography) {
      const css =
        typeof t.accord?.css === 'object' && t.accord.css.fontSize
          ? ` Font size in CSS: \`${t.accord.css.fontSize}\`.`
          : ''
      body.push(`- **${names.get(t)}**${t.description ? `: ${t.description}` : ''}${css}`)
    }
    body.push('')
  }
  if (spacing.length > 0) {
    body.push('## Layout', '')
    for (const t of spacing) body.push(line(names.get(t) as string, t, contexts))
    body.push('')
  }
  if (shadows.length > 0) {
    body.push('## Elevation & Depth', '')
    for (const t of shadows) body.push(line(names.get(t) as string, t, contexts))
    body.push('')
  }
  if (rounded.length > 0) {
    body.push('## Shapes', '')
    for (const t of rounded) body.push(line(names.get(t) as string, t, contexts))
    body.push('')
  }
  if (components.length > 0) {
    body.push('## Components', '')
    for (const c of components) {
      const variants = Object.entries(c.variants)
        .map(([axis, options]) => `${axis}: ${options.join(', ')}`)
        .join('; ')
      const where = c.mappings.code
        ? ` Code: \`${c.mappings.code.path}\` (\`${c.mappings.code.export}\`).`
        : ''
      body.push(
        `- **${c.name}**${c.status !== 'stable' ? ` (${c.status})` : ''}${variants ? ` – ${variants}.` : '.'}${where}`,
      )
    }
    body.push('')
  }
  if (decisions.length > 0) {
    body.push("## Do's and Don'ts", '')
    for (const d of decisions) {
      body.push(`- ${d.level === 'must' ? '**Must**' : 'Should'}: ${d.rule} – ${d.why} (${d.id})`)
    }
    body.push('')
  }

  return `---\n${stringify(frontMatter, { lineWidth: 0 })}---\n\n${body.join('\n')}`
}
