import {
  type CssVariable,
  cssToTokenValue,
  cssVariableName,
  detectSelector,
  resolveCssVariables,
  scopeMatches,
  toTokenValue,
} from '@decivo/accord-adapter-code'
import {
  aliasTarget,
  contextFile,
  parseTokens,
  RESOLVER_FILE,
  resolverDocument,
  type Token,
  type TokenFile,
  validateValue,
  valuesEqual,
} from '@decivo/accord-core'

/** What `accord init` took over as contexts (light/dark), and from where. */
export interface InitModes {
  source: 'code' | 'figma' | 'pen' | 'tokens'
  /** Code: the selector of the dark block, as written. */
  selector?: string | undefined
  /** Figma collections, the Pencil theme axis or the token files the contexts came from. */
  from: string[]
  /** All contexts, default first. */
  contexts: string[]
  default: string
  /** Values taken over per non-default context. */
  values: Record<string, number>
  /** Values that could not be read as their token's type, per context. */
  unreadable: Record<string, number>
  /** Variables declared only in a context, without a default value: no token to hold them, not taken over. */
  contextOnly?: Record<string, string[]> | undefined
}

/** Values of one non-default context: token path → `$value` (a DTCG value or a `{reference}`). */
export type ContextValues = Map<string, Map<string, unknown>>

/** Mode names that mean a theme context; anything else (Rounded/Pill, brands) is not a theme. */
export function themeContextName(mode: string): string | undefined {
  const name = mode
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/^hell$/, 'light')
    .replace(/^dunkel$/, 'dark')
  return /^(?:light|dark)(?:-high-contrast)?$|^high-contrast(?:-(?:light|dark))?$/.test(name)
    ? name
    : undefined
}

/** Default mode as a context: its theme name, else `light` (Default, Mode 1, Value). */
export const defaultContextName = (mode: string) => themeContextName(mode) ?? 'light'

/**
 * The dark values code declares: every token whose variable has another value under the dark selector.
 * A dark value that is just another token's variable (`--primary: var(--neutral-50)`) stays a reference.
 */
export function contextsFromCode(
  tokens: readonly Token[],
  variables: readonly CssVariable[],
): { selector?: string | undefined; values: ContextValues; unreadable: number; contextOnly: string[] } {
  const selector = detectSelector(variables)
  const values: ContextValues = new Map()
  if (!selector) return { values, unreadable: 0, contextOnly: [] }
  const inScope = (scope: string) => scopeMatches(scope, selector)
  const resolved = resolveCssVariables(variables, inScope)
  const byVariable = new Map(tokens.map((t) => [cssVariableName(t), t]))
  const dark = new Map<string, unknown>()
  let unreadable = 0
  for (const token of tokens) {
    if (token.inheritedFrom !== undefined || token.value === undefined) continue
    const variable = resolved.get(cssVariableName(token))
    if (!variable || variable.scope === 'base' || !inScope(variable.scope)) {
      // Not declared under the selector; it may still differ through var(), which the register expresses
      // with an alias. Only literal differences need a value of their own.
      if (!variable?.resolved || token.aliasOf !== undefined) continue
      const value = cssToTokenValue(token.type, variable.resolved)
      if (value !== undefined && !valuesEqual(token.type, value, token.value)) dark.set(token.path, value)
      continue
    }
    const value = variable.resolved === undefined ? undefined : cssToTokenValue(token.type, variable.resolved)
    if (value === undefined || validateValue(token.type, value).length > 0) {
      unreadable++
      continue
    }
    if (valuesEqual(token.type, value, token.value)) continue
    const target = /^var\(\s*(--[\w-]+)\s*\)$/.exec(variable.value)?.[1]
    const aliased = target ? byVariable.get(target) : undefined
    dark.set(
      token.path,
      aliased && aliased !== token && aliased.type === token.type ? `{${aliased.path}}` : value,
    )
  }
  values.set('dark', dark)
  // A variable only the dark block declares has no default value, so no token holds it: name it, never drop it silently.
  const base = new Set(variables.filter((v) => !inScope(v.scope)).map((v) => v.name))
  const contextOnly = [
    ...new Set(
      variables
        .filter((v) => v.scope !== 'base' && inScope(v.scope) && !base.has(v.name) && !byVariable.has(v.name))
        .map((v) => v.name),
    ),
  ].sort()
  return { selector, values, unreadable, contextOnly }
}

/** A variable of a design tool in another mode, with the context it belongs to. */
export interface DesignModeValue {
  /** Variable name as the tool writes it. */
  name: string
  context: string
  value: unknown
  /** Variable this one points to in that mode. */
  alias?: string | undefined
}

/** Values of a design tool's other modes, as `$value`s of the tokens their variables became. */
export function contextsFromDesign(
  tokens: ReadonlyMap<string, Token>,
  paths: ReadonlyMap<string, string>,
  modeValues: readonly DesignModeValue[],
): { values: ContextValues; unreadable: Record<string, number> } {
  const values: ContextValues = new Map()
  const unreadable: Record<string, number> = {}
  for (const m of modeValues) {
    const path = paths.get(m.name)
    const token = path ? tokens.get(path) : undefined
    if (!token || token.value === undefined) continue
    const list = values.get(m.context) ?? new Map<string, unknown>()
    values.set(m.context, list)
    const target = m.alias ? paths.get(m.alias) : undefined
    const aliased = target ? tokens.get(target) : undefined
    if (aliased && aliased !== token && aliased.type === token.type) {
      if (token.aliasOf !== aliased.path) list.set(token.path, `{${aliased.path}}`)
      continue
    }
    const value = toTokenValue(token, m.value)
    if (value === undefined || validateValue(token.type, value).length > 0) {
      unreadable[m.context] = (unreadable[m.context] ?? 0) + 1
      continue
    }
    if (!valuesEqual(token.type, value, token.value) || token.aliasOf !== undefined)
      list.set(token.path, value)
  }
  return { values, unreadable }
}

/**
 * Values of an alternate token file (`dark.tokens.json` next to `light.tokens.json`) that differ from the
 * register: references stay references where their target is a token of the register.
 */
export function contextFromTokenFile(
  tokens: ReadonlyMap<string, Token>,
  file: TokenFile,
): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const alt of parseTokens([file]).tokens.values()) {
    const token = tokens.get(alt.path)
    if (!token || token.value === undefined || alt.value === undefined || alt.type !== token.type) continue
    const target = aliasTarget(alt.rawValue)
    if (target !== undefined && tokens.has(target)) {
      if (target !== token.aliasOf) out.set(token.path, alt.rawValue)
      continue
    }
    if (validateValue(token.type, alt.value).length > 0) continue
    if (!valuesEqual(token.type, alt.value, token.value)) out.set(token.path, alt.value)
  }
  return out
}

type Obj = Record<string, unknown>

/** The context files and resolver.json for a set of context values. Empty contexts get no file. */
export function modeFiles(input: {
  tokenFiles: readonly string[]
  default: string
  values: ContextValues
}): Map<string, string> {
  const files = new Map<string, string>()
  const contextFiles = new Map<string, string>()
  for (const [context, values] of input.values) {
    if (values.size === 0) continue
    const content: Obj = {}
    for (const [path, value] of [...values].sort(([a], [b]) => a.localeCompare(b))) {
      let node = content
      const segs = path.split('.')
      for (const seg of segs.slice(0, -1)) {
        node[seg] = (node[seg] as Obj | undefined) ?? {}
        node = node[seg] as Obj
      }
      node[segs.at(-1) as string] = { $value: value }
    }
    const file = contextFile(context)
    files.set(file, `${JSON.stringify(content, null, 2)}\n`)
    contextFiles.set(context, file)
  }
  if (contextFiles.size === 0) return files
  const contexts = [input.default, ...[...input.values.keys()].filter((c) => c !== input.default)]
  const doc = resolverDocument({
    tokenFiles: input.tokenFiles,
    contexts,
    default: input.default,
    files: contextFiles,
  })
  files.set(RESOLVER_FILE, `${JSON.stringify(doc, null, 2)}\n`)
  return files
}
