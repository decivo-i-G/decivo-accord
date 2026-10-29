import { splitTopLevel } from '@decivo/accord-core'
import postcss, { type AtRule, type Container, type Rule } from 'postcss'
import valueParser from 'postcss-value-parser'

/** A custom property declaration found in a stylesheet. */
export interface CssVariable {
  name: string
  /** Value as written, e.g. `var(--brand-700)` or `#3c6681`. */
  value: string
  /** Where it applies: `base` for `:root`/`html`/`@theme`, otherwise the selector (`.dark`, `.admin-theme`). */
  scope: string
  /** For a base selector list with other members (`:root, .dark`): the list, so `.dark` sees the value too. */
  list?: string
  /** `@theme`, `@theme inline`, `:root`, … — kept for reports. */
  context: string
  file: string
  line: number
}

const BASE_SELECTORS = new Set([':root', 'html', ':host'])

/**
 * One selector or media condition in a comparable spelling: lower case, single spaces, attribute values
 * without quotes. `[data-theme='dark']`, `[data-theme="dark"]` and `[data-theme=dark]` are the same.
 */
export function normalizeSelector(selector: string): string {
  return selector
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\[\s*([\w-]+)\s*=\s*(['"]?)([^'"\]]*)\2\s*\]/g, '[$1=$3]')
    .replace(/\(\s*([\w-]+)\s*:\s*([^)]*?)\s*\)/g, '($1:$2)')
    .replace(/\s*([>+~,])\s*/g, '$1')
}

/** The selectors of a selector list (`:root, [data-theme=light]`), or the scope itself (`@media …`). */
const members = (scope: string) => (scope.startsWith('@') ? [scope] : splitTopLevel(scope, ','))

/** Whether a variable scope (`.dark`, `.dark, [data-theme=dark]`, `@media …`) is the given selector. */
export function scopeMatches(scope: string, selector: string): boolean {
  const target = normalizeSelector(selector)
  return normalizeSelector(scope) === target || members(scope).some((m) => normalizeSelector(m) === target)
}

/**
 * Selectors of a default (light) theme: `[data-theme="light"]`, `.light`, `:root:not(.dark)`. Variables there
 * count as base values wherever `:root` does not define them, so a theme written only with `[data-theme]`
 * is read like one written with `:root`.
 */
const DEFAULT_THEME =
  /^(?::root|html)?(?:\.light|\[data-(?:theme|mode|color-scheme|color-mode)=(?:light|default)\])$|^(?::root|html):not\((?:\.dark|\[data-(?:theme|mode)=dark\])\)$/

export const isDefaultThemeScope = (scope: string) =>
  scope !== 'base' && members(scope).some((m) => DEFAULT_THEME.test(normalizeSelector(m)))

/**
 * Where code puts its dark values, most common first: shadcn/Tailwind `.dark`, then `data-theme`/`data-mode`
 * attributes, then the system setting. Used when `surfaces.code.modes` names no selector (F14).
 */
export const DARK_SELECTORS = [
  '.dark',
  'html.dark',
  ':root.dark',
  '[data-theme="dark"]',
  ':root[data-theme="dark"]',
  'html[data-theme="dark"]',
  '[data-mode="dark"]',
  '@media (prefers-color-scheme: dark)',
] as const

/**
 * The selector a stylesheet uses for a context, as written there (`[data-theme='dark']`), from a list of
 * candidates in order of preference. Undefined when no variable is declared under any of them.
 */
export function detectSelector(
  variables: readonly CssVariable[],
  candidates: readonly string[] = DARK_SELECTORS,
): string | undefined {
  for (const candidate of candidates) {
    const target = normalizeSelector(candidate)
    for (const v of variables) {
      if (v.scope === 'base') continue
      const written = members(v.scope).find((m) => normalizeSelector(m) === target)
      if (written) return written.trim()
    }
  }
  return undefined
}

/** Whether a selector targets the root element, possibly narrowed: `:root`, `html.dark`, `:root:not(.light)`. */
const ROOTISH = /^(?::root|html|:host)(?![\w-])/

function contextOf(node: Container): { scope: string; context: string; list?: string } {
  const parts: string[] = []
  const conditions: string[] = []
  let selector: string | undefined
  let theme = false
  let current: Container | undefined = node
  while (current && current.type !== 'root') {
    if (current.type === 'rule') {
      const written = (current as Rule).selector.trim()
      parts.unshift(written)
      // The innermost rule decides which element a variable applies to.
      if (selector === undefined) selector = written
    } else if (current.type === 'atrule') {
      const at = current as AtRule
      const label = `@${at.name}${at.params ? ` ${at.params}` : ''}`
      parts.unshift(label)
      if (at.name === 'theme') theme = true
      // Media queries and the like do not change the element, but variables inside them only apply sometimes.
      if (at.name === 'media' || at.name === 'supports' || at.name === 'container') conditions.unshift(label)
    }
    current = current.parent as Container | undefined
  }
  const context = parts.join(' › ') || '(root)'
  const list = selector === undefined ? [] : members(selector).map(normalizeSelector)
  // A selector list that includes :root applies to the root element like :root alone; its other members
  // (`:root, .dark`) also apply in their own context, so the list is kept for that.
  const base = selector === undefined || theme || list.some((m) => BASE_SELECTORS.has(m))
  const mixed = selector !== undefined && base && !list.every((m) => BASE_SELECTORS.has(m))
  const element = base ? 'base' : (selector as string)
  if (conditions.length === 0)
    return { scope: element, context, ...(mixed ? { list: selector as string } : {}) }
  // One condition around the root element (`@media (prefers-color-scheme: dark) { :root { … } }`) is that
  // condition's scope. A condition around another element (`img`, `.card`) or several nested conditions
  // never stand for a whole context, so they get a scope no context selector matches.
  if (conditions.length === 1 && (base || list.every((m) => ROOTISH.test(m))))
    return { scope: conditions[0] as string, context }
  return { scope: [...conditions, element].join(' › '), context }
}

/** Where declarations in this rule apply: `base`, a selector such as `.dark`, or a media condition. */
export const scopeOf = (node: Container): string => contextOf(node).scope

/** All custom property declarations in a stylesheet. Tailwind v4 `@theme` blocks count as base scope. */
export function parseCssVariables(css: string, file: string): CssVariable[] {
  const root = postcss.parse(css, { from: file })
  const out: CssVariable[] = []
  root.walkDecls(/^--/, (decl) => {
    const parent = decl.parent as Container
    const { scope, context, list } = contextOf(parent)
    out.push({
      name: decl.prop,
      value: decl.value.trim(),
      scope,
      ...(list ? { list } : {}),
      context,
      file,
      line: decl.source?.start?.line ?? 0,
    })
  })
  return out
}

export interface ResolvedVariable extends CssVariable {
  /** Value with every `var()` replaced, or undefined when a reference cannot be resolved. */
  resolved: string | undefined
  /** Variables this one points to directly, e.g. `--color-brand` → [`--brand-blue`]. */
  references: string[]
}

/**
 * Resolve `var()` references within one scope. Later declarations win (CSS cascade within a scope);
 * a scope falls back to `base` for variables it does not define. `scope` is a scope as recorded
 * (`.dark`) or a test, e.g. `(s) => scopeMatches(s, '[data-theme=dark]')`. Variables of a default theme
 * (`[data-theme=light]`) fill in what the base scope does not define.
 */
export function resolveCssVariables(
  variables: readonly CssVariable[],
  scope: string | ((scope: string) => boolean) = 'base',
): Map<string, ResolvedVariable> {
  const byName = new Map<string, CssVariable>()
  for (const v of variables) if (v.scope === 'base') byName.set(v.name, v)
  const own = new Set(byName.keys())
  for (const v of variables) if (isDefaultThemeScope(v.scope) && !own.has(v.name)) byName.set(v.name, v)
  const inScope = typeof scope === 'string' ? (s: string) => s === scope : scope
  if (scope !== 'base')
    for (const v of variables)
      if (v.scope !== 'base' ? inScope(v.scope) : v.list !== undefined && inScope(v.list))
        byName.set(v.name, v)

  const cache = new Map<string, string | undefined>()
  const resolving = new Set<string>()

  const resolve = (name: string): string | undefined => {
    if (cache.has(name)) return cache.get(name)
    const variable = byName.get(name)
    if (!variable || resolving.has(name)) return undefined
    resolving.add(name)
    const result = substitute(variable.value)
    resolving.delete(name)
    cache.set(name, result)
    return result
  }

  const substitute = (value: string): string | undefined => {
    let failed = false
    const parsed = valueParser(value)
    parsed.walk((node) => {
      if (node.type !== 'function' || node.value !== 'var') return
      const [first, , ...fallback] = node.nodes
      const target = first?.value
      let replacement = target ? resolve(target) : undefined
      if (replacement === undefined && fallback.length > 0)
        replacement = substitute(valueParser.stringify(fallback))
      if (replacement === undefined) failed = true
      const replaced = node as unknown as { type: string; value: string }
      replaced.type = 'word'
      replaced.value = replacement ?? ''
      return false
    })
    return failed ? undefined : parsed.toString().trim()
  }

  const out = new Map<string, ResolvedVariable>()
  for (const [name, variable] of byName) {
    const references: string[] = []
    valueParser(variable.value).walk((node) => {
      if (node.type === 'function' && node.value === 'var' && node.nodes[0])
        references.push(node.nodes[0].value)
    })
    out.set(name, { ...variable, resolved: resolve(name), references })
  }
  return out
}

/**
 * Every variable connected to `names`: the variables they point to (transitively) and the aliases that
 * point to any of those. `--brand-blue` belongs to the token behind `--color-brand: var(--brand-blue)`.
 */
export function linkedVariables(
  variables: ReadonlyMap<string, ResolvedVariable>,
  names: Iterable<string>,
): Set<string> {
  const linked = new Set(names)
  const addTargets = (name: string) => {
    for (const ref of variables.get(name)?.references ?? []) {
      if (!linked.has(ref)) {
        linked.add(ref)
        addTargets(ref)
      }
    }
  }
  for (const name of [...linked]) addTargets(name)
  const reaches = (name: string, seen: Set<string>): boolean =>
    linked.has(name) ||
    (!seen.has(name) && (variables.get(name)?.references ?? []).some((r) => reaches(r, seen.add(name))))
  for (const name of variables.keys()) if (reaches(name, new Set())) linked.add(name)
  return linked
}
