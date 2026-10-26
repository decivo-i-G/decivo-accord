import type { ResolvedVariable } from './css-vars.js'

const UTILITIES =
  'bg|text|border|border-[trblxy]|ring|ring-offset|fill|stroke|from|via|to|outline|decoration|divide|placeholder|caret|accent|shadow|inset-shadow'
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * How often each CSS variable is used in code: `var(--x)` plus Tailwind v4 utilities generated
 * from `@theme` colours (`--color-brand` → `bg-brand`, `text-brand/80`). Usage of an alias counts
 * for the variable it points to as well, so `--brand-700` gets the uses of `--color-primary`.
 */
export function countVariableUsage(
  sources: readonly string[],
  variables: ReadonlyMap<string, ResolvedVariable>,
): Map<string, number> {
  const direct = countDirectUsage(sources, variables)
  // Propagate through var() chains: an alias's uses also use its target.
  const total = new Map(direct)
  const visit = (name: string, uses: number, seen: Set<string>) => {
    for (const ref of variables.get(name)?.references ?? []) {
      if (seen.has(ref)) continue
      seen.add(ref)
      total.set(ref, (total.get(ref) ?? 0) + uses)
      visit(ref, uses, seen)
    }
  }
  for (const [name, uses] of direct) if (uses > 0) visit(name, uses, new Set([name]))
  return total
}

/**
 * Usage sites that go through any of `tokenVariables`, each site counted once even when
 * the variable it names is an alias of another token variable.
 */
export function countTokenUses(
  sources: readonly string[],
  variables: ReadonlyMap<string, ResolvedVariable>,
  tokenVariables: ReadonlySet<string>,
): number {
  const reachesToken = (name: string, seen = new Set<string>()): boolean => {
    if (tokenVariables.has(name)) return true
    if (seen.has(name)) return false
    seen.add(name)
    return (variables.get(name)?.references ?? []).some((ref) => reachesToken(ref, seen))
  }
  let uses = 0
  for (const [name, count] of countDirectUsage(sources, variables))
    if (count > 0 && reachesToken(name)) uses += count
  return uses
}

function countDirectUsage(
  sources: readonly string[],
  variables: ReadonlyMap<string, ResolvedVariable>,
): Map<string, number> {
  // `--color-primary: var(--brand-700)` defines an alias; it is not a use.
  const text = sources.join('\n').replace(/--[\w-]+\s*:[^;{}]*;/g, '')
  const direct = new Map<string, number>()
  for (const name of variables.keys()) {
    let count = text.split(`var(${name}`).length - 1
    const color = /^--color-(.+)$/.exec(name)
    if (color) {
      const re = new RegExp(
        `(?<![\\w-])(?:[\\w-]+:)*(?:${UTILITIES})-${escapeRegExp(color[1] as string)}(?:/\\d+)?(?![\\w-])`,
        'g',
      )
      count += text.match(re)?.length ?? 0
    }
    direct.set(name, count)
  }
  return direct
}
