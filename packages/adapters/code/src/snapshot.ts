import {
  type Config,
  type Coverage,
  contextKey,
  cssToColor,
  cssToDimension,
  cssToDuration,
  cssToShadow,
  FONT_WEIGHT_ALIASES,
  otherContexts,
  type RegisterModes,
  type Snapshot,
  type SnapshotToken,
  splitTopLevel,
  type Token,
  type TokenType,
  valuesEqual,
} from '@decivo/accord-core'
import {
  type CssVariable,
  detectSelector,
  type ResolvedVariable,
  resolveCssVariables,
  scopeMatches,
} from './css-vars.js'

/** Token types a single CSS custom property can carry. */
const CSS_TYPES: readonly TokenType[] = [
  'color',
  'dimension',
  'fontFamily',
  'fontWeight',
  'number',
  'shadow',
  'duration',
]

/** CSS custom property for a token: `ids.css`, else `--color-brand-600` for `color.brand.600` (`$root` dropped). */
export function cssVariableName(token: Pick<Token, 'path' | 'accord'>): string {
  if (token.accord?.ids?.css) return token.accord.ids.css
  return `--${token.path
    .split('.')
    .filter((s) => s !== '$root')
    .join('-')}`
}

/** Parse a resolved CSS value as a DTCG value of `type`. */
export function cssToTokenValue(type: TokenType, css: string): unknown {
  switch (type) {
    case 'color':
      return cssToColor(css)
    case 'dimension':
      return cssToDimension(css)
    case 'duration':
      return cssToDuration(css)
    case 'shadow': {
      const layers = cssToShadow(css)
      return layers && (layers.length === 1 ? layers[0] : layers)
    }
    case 'fontFamily': {
      const families = splitTopLevel(css, ',').map((f) => f.replace(/^['"]|['"]$/g, ''))
      return families.length === 1 ? families[0] : families
    }
    case 'fontWeight': {
      if (/^\d+$/.test(css)) return Number(css)
      return css in FONT_WEIGHT_ALIASES ? css : undefined
    }
    case 'number': {
      const n = Number(css)
      return Number.isNaN(n) ? undefined : n
    }
    default:
      return undefined
  }
}

export interface CodeSnapshot {
  snapshot: Snapshot
  /** Register tokens with no CSS variable in code. */
  missing: string[]
  /** Variables whose value could not be read as the token's type (e.g. `clamp()` for a dimension). */
  unreadable: { path: string; variable: string; value: string }[]
}

/**
 * The code surface as a snapshot: each register token is looked up as a CSS custom property
 * in the base scope. Covers every token a single CSS variable can express; components are not covered yet.
 */
export function codeSnapshot(
  tokens: Iterable<Token>,
  variables: ReadonlyMap<string, ResolvedVariable>,
  /** Variable name per token; other surfaces (Claude Design) may name them differently. */
  nameOf: (token: Token) => string = cssVariableName,
): CodeSnapshot {
  const snapshotTokens = new Map<string, SnapshotToken>()
  const covered: string[] = []
  const missing: string[] = []
  const unreadable: CodeSnapshot['unreadable'] = []

  for (const token of tokens) {
    if (!CSS_TYPES.includes(token.type)) continue
    covered.push(token.path)
    const name = nameOf(token)
    const variable = variables.get(name)
    if (!variable) {
      missing.push(token.path)
      continue
    }
    if (variable.resolved === undefined) {
      unreadable.push({ path: token.path, variable: name, value: variable.value })
      continue
    }
    const value = cssToTokenValue(token.type, variable.resolved)
    if (value === undefined) {
      unreadable.push({ path: token.path, variable: name, value: variable.resolved })
      continue
    }
    snapshotTokens.set(token.path, { type: token.type, value })
  }

  // Unreadable values (fluid sizes) are not drift; leave them out of the coverage.
  const unreadablePaths = new Set(unreadable.map((u) => u.path))
  const coverage: Coverage = { tokens: covered.filter((p) => !unreadablePaths.has(p)), components: [] }
  return { snapshot: { tokens: snapshotTokens, components: new Map(), coverage }, missing, unreadable }
}

/** How code expresses one non-default context of the register (F14). */
export interface CodeModeSelector {
  context: string
  /** Selector or media condition as written, e.g. `.dark` or `@media (prefers-color-scheme: dark)`. */
  selector?: string | undefined
  /**
   * configured: from `surfaces.code.modes`. detected: found in the stylesheets (only for `dark`, when nothing
   * is configured). missing: no selector, so this context is not compared with code.
   */
  how: 'configured' | 'detected' | 'missing'
  /** Whether any variable is declared under the selector. */
  found: boolean
}

/** The selector per non-default context: configured in `surfaces.code.modes`, else detected for `dark`. */
export function codeModeSelectors(
  register: { config: Pick<Config, 'surfaces'>; modes?: RegisterModes | undefined },
  variables: readonly CssVariable[],
): CodeModeSelector[] {
  const configured = register.config.surfaces.code.modes ?? {}
  return otherContexts(register).map((context): CodeModeSelector => {
    const selector = configured[context]
    if (selector !== undefined) {
      const found = variables.some((v) => v.scope !== 'base' && scopeMatches(v.scope, selector))
      return { context, selector, how: 'configured', found }
    }
    const detected = context === 'dark' ? detectSelector(variables) : undefined
    return detected
      ? { context, selector: detected, how: 'detected', found: true }
      : { context, how: 'missing', found: false }
  })
}

/**
 * Values of each context under its selector, for the tokens the snapshot already covers: a token is listed
 * where code declares its variable under the selector or where its value there differs (through `var()`).
 * Everything else falls back to the base value, as in the browser.
 */
export function withCodeContexts(
  snapshot: Snapshot,
  tokens: Iterable<Token>,
  variables: readonly CssVariable[],
  selectors: readonly CodeModeSelector[],
  modifier: string,
  nameOf: (token: Token) => string = cssVariableName,
): Snapshot {
  const usable = selectors.filter((s) => s.selector !== undefined && s.found)
  if (usable.length === 0) return snapshot
  const list = [...tokens]
  const contexts = new Map<string, Map<string, SnapshotToken>>()
  for (const { context, selector } of usable) {
    const inScope = (scope: string) => scopeMatches(scope, selector as string)
    const resolved = resolveCssVariables(variables, inScope)
    const declared = new Set(
      variables.filter((v) => v.scope !== 'base' && inScope(v.scope)).map((v) => v.name),
    )
    const values = new Map<string, SnapshotToken>()
    for (const token of list) {
      const base = snapshot.tokens.get(token.path)
      if (!base) continue
      const name = nameOf(token)
      const css = resolved.get(name)?.resolved
      const value = css === undefined ? undefined : cssToTokenValue(token.type, css)
      if (value === undefined) continue
      if (declared.has(name) || !valuesEqual(token.type, base.value, value))
        values.set(token.path, { type: token.type, value })
    }
    contexts.set(contextKey({ [modifier]: context }), values)
  }
  return {
    ...snapshot,
    contexts,
    coverage: { ...snapshot.coverage, contexts: [...contexts.keys()] },
  }
}
