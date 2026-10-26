import { type ColorValue, contrastRatio, cssToColor, type Register } from '@decivo/accord-core'
import { aliasChain } from './register-view'

/** What else moves when a token changes, as numbers (the page formats them). */
export interface Impact {
  /** Tokens that reference this one, directly or through other aliases. */
  aliases: string[]
  /** References in the scanned code of the token and its aliases; undefined when no code was scanned. */
  uses?: number | undefined
  /** Colours: WCAG contrast against a surface or text token, before and after. */
  contrast?: { token: string; before: number; after: number } | undefined
}

/** Tokens a colour is usually read against, first match wins. */
const BACKDROPS = ['color.surface', 'color.background', 'color.bg', 'color.surface.page', 'color.text']

/** Every token whose alias chain reaches `path` (`color.brand` → `blue.600`). */
export function aliasesOf(register: Pick<Register, 'tokens'>, path: string): string[] {
  return [...register.tokens.keys()]
    .filter((p) => p !== path && aliasChain(register, p).includes(path))
    .sort()
}

/** Uses of a token and of everything that aliases it, from the drift report's usage counts. */
export function usesOf(
  register: Pick<Register, 'tokens'>,
  paths: string[],
  usage: Record<string, number> | undefined,
): number {
  const all = new Set(paths.flatMap((p) => [p, ...aliasesOf(register, p)]))
  return [...all].reduce((sum, p) => sum + (usage?.[p] ?? 0), 0)
}

export function impactOf(
  register: Pick<Register, 'tokens'>,
  change: { token: string; type: string; before?: string | undefined; after?: string | undefined },
  code: { scanned: boolean; usage?: Record<string, number> | undefined },
): Impact {
  const aliases = aliasesOf(register, change.token)
  const impact: Impact = {
    aliases,
    uses: code.scanned ? usesOf(register, [change.token], code.usage) : undefined,
  }
  const before = change.before ? cssToColor(change.before) : undefined
  const after = change.after ? cssToColor(change.after) : undefined
  if (before && after) {
    const own = new Set([change.token, ...aliases])
    for (const path of BACKDROPS) {
      const token = register.tokens.get(path)
      if (token?.type !== 'color' || !token.value || own.has(path)) continue
      if (aliasChain(register, path).includes(change.token)) continue
      const backdrop = token.value as ColorValue
      impact.contrast = {
        token: path,
        before: contrastRatio(before, backdrop),
        after: contrastRatio(after, backdrop),
      }
      break
    }
  }
  return impact
}
