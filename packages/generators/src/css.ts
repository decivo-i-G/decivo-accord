import { cssVariableName } from '@decivo/accord-adapter-code'
import type { Register } from '@decivo/accord-core'
import { contextOutputs, GENERATED_NOTICE, type GeneratorRegister, ownTokens, tokenCss } from './values.js'

/**
 * `:root` custom properties for every token a single CSS property can carry, then one block per context with
 * the values that differ there: `.dark { … }` (or the selector in `surfaces.code.modes`), or
 * `@media (prefers-color-scheme: dark) { :root { … } }` for a media condition.
 */
export function generateCss(register: GeneratorRegister, fingerprint: string): string {
  const lines = [`/* ${GENERATED_NOTICE} accord:${fingerprint} */`, ':root {']
  for (const token of ownTokens(register)) {
    const value = tokenCss(register, token)
    if (value === undefined) continue
    const description = token.description ? ` /* ${token.description.replace(/\*\//g, '* /')} */` : ''
    lines.push(`  ${cssVariableName(token)}: ${value};${description}`)
  }
  lines.push('}', '')
  for (const context of contextOutputs(register)) {
    const declarations: string[] = []
    for (const token of context.tokens) {
      const value = tokenCss(context.register, token)
      if (value !== undefined) declarations.push(`${cssVariableName(token)}: ${value};`)
    }
    if (declarations.length === 0) continue
    const media = context.selector.startsWith('@')
    lines.push(`/* Context ${context.context} */`)
    if (media)
      lines.push(`${context.selector} {`, '  :root {', ...declarations.map((d) => `    ${d}`), '  }', '}', '')
    else lines.push(`${context.selector} {`, ...declarations.map((d) => `  ${d}`), '}', '')
  }
  return lines.join('\n')
}

/** Tailwind v4 theme namespace for a token, so utilities like `bg-brand-600` exist. */
function themeName(path: string, type: string): string | undefined {
  const segs = path.split('.').filter((s) => s !== '$root')
  const [group, ...rest] = segs
  const name = rest.join('-') || group
  if (type === 'color') return `--color-${group === 'color' || group === 'colors' ? name : segs.join('-')}`
  if (type === 'shadow') return `--shadow-${group === 'shadow' ? name : segs.join('-')}`
  if (type === 'fontFamily')
    return `--font-${group === 'font' || group === 'fontFamily' ? name : segs.join('-')}`
  if (type === 'dimension' && /radius|rounded/.test(path))
    return `--radius-${group === 'radius' || group === 'rounded' ? name : segs.join('-')}`
  return undefined
}

/**
 * Tailwind v4 `@theme inline` block mapping theme names to the token variables.
 * Only colours, radii, shadows and font families; spacing in v4 is a single `--spacing` base.
 */
export function generateTailwindTheme(register: Pick<Register, 'tokens'>, fingerprint: string): string {
  const lines = [`/* ${GENERATED_NOTICE} accord:${fingerprint} */`, '@theme inline {']
  for (const token of ownTokens(register)) {
    const name = themeName(token.path, token.type)
    const variable = cssVariableName(token)
    if (!name || name === variable) continue
    lines.push(`  ${name}: var(${variable});`)
  }
  lines.push('}', '')
  return lines.join('\n')
}
