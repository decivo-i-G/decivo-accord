import {
  buildTokenIndex,
  type HardValue,
  type HardValueFinding,
  matchColor,
  scanScript,
  scanStylesheet,
} from '@decivo/accord-adapter-code'
import { type ColorValue, colorToCss, type Register } from '@decivo/accord-core'
import { Parser } from 'htmlparser2'
import type { HandoffBundle } from './bundle.js'

/** 1-based line and column for a character offset. */
function locator(text: string) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  return (offset: number) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if ((starts[mid] as number) <= offset) lo = mid
      else hi = mid - 1
    }
    return { line: lo + 1, column: offset - (starts[lo] as number) + 1 }
  }
}

const shift = (values: HardValue[], line: number, column: number, file: string): HardValue[] =>
  values.map((v) => ({
    ...v,
    file,
    line: v.line + line - 1,
    column: v.line === 1 ? v.column + column - 1 : v.column,
  }))

/** Template expressions like `{{ L.asideDisplay }}` are not CSS; neutralise them before parsing. */
const stripTemplates = (text: string) => text.replace(/\{\{[^}]*\}\}/g, 'inherit')

/**
 * Literal colours in a design page: `style` attributes, `<style>` blocks and the page's logic scripts
 * (Claude Design keeps state-dependent styles in `text/x-dc` scripts).
 */
export function pageLiterals(page: { path: string; html: string }): HardValue[] {
  const at = locator(page.html)
  const out: HardValue[] = []
  let inStyle = false
  let inScript = false
  let blockStart = 0
  let buffer = ''

  const parser: Parser = new Parser(
    {
      onopentag(name, attributes) {
        const style = attributes.style
        if (style) {
          const { line, column } = at(parser.startIndex)
          try {
            out.push(
              ...shift(scanStylesheet(`x{${stripTemplates(style)}}`, page.path), line, column, page.path),
            )
          } catch {
            // Malformed inline style: skip it rather than fail the whole page.
          }
        }
        if (name === 'style') inStyle = true
        if (
          name === 'script' &&
          (attributes.type === 'text/x-dc' || attributes.type === undefined) &&
          !attributes.src
        )
          inScript = true
        blockStart = parser.endIndex + 1
        buffer = ''
      },
      ontext(text) {
        if (inStyle || inScript) buffer += text
      },
      onclosetag(name) {
        if ((name === 'style' && inStyle) || (name === 'script' && inScript)) {
          const { line, column } = at(blockStart)
          try {
            const found =
              name === 'style'
                ? scanStylesheet(stripTemplates(buffer), page.path)
                : scanScript(buffer, page.path)
            out.push(...shift(found, line, column, page.path))
          } catch {
            // Unparseable block: the rest of the page still counts.
          }
          inStyle = false
          inScript = false
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true },
  )
  parser.write(page.html)
  parser.end()
  return out
}

/** One distinct colour used in a draft, with where it appears and the closest register tokens. */
export interface DraftColor {
  value: string
  count: number
  files: string[]
  exact: string[]
  near?: { path: string; distance: number } | undefined
}

export interface HandoffAnalysis {
  literals: HardValueFinding[]
  colors: DraftColor[]
}

/**
 * Map every colour in the handoff to register tokens (exact or near miss). Pass `tokenUsage` from a
 * code scan so that, among equal values, the token the code already uses is suggested.
 */
export function analyseHandoff(
  bundle: HandoffBundle,
  register: Pick<Register, 'config' | 'tokens'>,
  options: { tokenUsage?: ReadonlyMap<string, number> } = {},
): HandoffAnalysis {
  const index = buildTokenIndex(register.tokens.values(), options.tokenUsage)
  const near = register.config.matching.color_near_delta_e
  const literals: HardValueFinding[] = [
    ...bundle.pages.flatMap((p) => pageLiterals(p)),
    ...bundle.styles.flatMap((s) => scanStylesheet(stripTemplates(s.css), s.path)),
  ]
    .filter((v) => v.kind === 'color')
    .map((v) => ({ ...v, match: matchColor(index, v.value as ColorValue, near) }))

  const byValue = new Map<string, DraftColor>()
  for (const l of literals) {
    const key = colorToCss(l.value as ColorValue)
    const entry = byValue.get(key) ?? {
      value: key,
      count: 0,
      files: [],
      exact: l.match.exact,
      near: l.match.near,
    }
    entry.count++
    if (!entry.files.includes(l.file)) entry.files.push(l.file)
    byValue.set(key, entry)
  }
  const colors = [...byValue.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
  return { literals, colors }
}
