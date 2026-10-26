import { type ParsedTokens, parseTokens, type TokenFile } from '../dtcg/parse.js'
import type { Token } from '../dtcg/types.js'
import type { Issue } from '../issues.js'
import { joinPath, splitPath } from '../paths.js'
import { type ModeContext, type ResolverModel, THEME_MODIFIER } from './resolver.js'

/**
 * The register's contexts (light, dark, …) as Accord resolves them. Without `resolver.json` a register has
 * none and everything works on the token files alone, as before.
 */
export interface RegisterModes {
  /** The modifier the contexts belong to (`theme`). */
  modifier: string
  /** Context whose values are the token files under `tokens/` (e.g. `light`). */
  default: string
  /** All contexts in the resolver's order, the default included. */
  contexts: string[]
  /** Register files per non-default context, e.g. `dark` → [`modes/theme/dark.tokens.json`]. */
  files: Map<string, string[]>
  /**
   * Every token as it resolves in each non-default context. A token the context does not set falls back to
   * the default value (resolver semantics); aliases resolve within the context, so `color.text` →
   * `{color.foreground}` follows a dark `color.foreground`.
   */
  tokens: Map<string, Map<string, Token>>
  /** Per non-default context: the tokens it sets itself, with the file that sets them. */
  own: Map<string, Map<string, string>>
}

type Obj = Record<string, unknown>
const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const issueKey = (i: Issue) => `${i.code}|${i.path ?? ''}|${i.message}`

/**
 * Resolve every non-default context: the context files are laid over the token files (a token the context
 * sets gets its `$value` from there) and the result is parsed like the register itself, so types, aliases
 * and `$extends` behave the same in every context. A context may only set tokens the register has, with
 * their type; it never adds or removes tokens.
 */
export function resolveModes(
  model: ResolverModel,
  baseFiles: readonly TokenFile[],
  base: Pick<ParsedTokens, 'tokens' | 'issues'>,
  read: (path: string) => string | undefined,
): { modes: RegisterModes; issues: Issue[] } {
  const issues: Issue[] = []
  const baseIssues = new Set(base.issues.map(issueKey))
  const tokens = new Map<string, Map<string, Token>>()
  const own = new Map<string, Map<string, string>>()

  for (const [context, files] of model.files) {
    const overlaid = baseFiles.map((f) => ({ file: f.file, content: structuredClone(f.content) }))
    const byFile = new Map(overlaid.map((f) => [f.file, f.content]))
    const set = new Map<string, string>()

    for (const file of files) {
      const error = (code: string, message: string, path?: string) =>
        issues.push({ severity: 'error', code, file, message, ...(path !== undefined ? { path } : {}) })
      let content: unknown
      try {
        content = JSON.parse(read(file) ?? '')
      } catch (e) {
        error('json', (e as Error).message)
        continue
      }
      if (!isObject(content)) {
        error('not-an-object', 'a token file must contain a JSON object')
        continue
      }

      const setToken = (node: Obj, path: string, type: string | undefined) => {
        const token = base.tokens.get(path)
        if (!token) {
          error(
            'context-unknown-token',
            `${context} sets ${path}, which the register does not have; add it under tokens/ first`,
            path,
          )
          return
        }
        if (token.inheritedFrom !== undefined) {
          error(
            'context-inherited',
            `${path} is inherited from ${token.inheritedFrom}; set ${token.inheritedFrom} instead`,
            path,
          )
          return
        }
        if (type !== undefined && type !== token.type) {
          error('context-type', `${path} is ${token.type} in the register, ${type} in ${context}`, path)
          return
        }
        let target: unknown = byFile.get(token.file)
        for (const seg of splitPath(path)) target = isObject(target) ? target[seg] : undefined
        if (!isObject(target)) return
        target.$value = structuredClone(node.$value)
        set.set(path, file)
      }

      const walk = (node: Obj, segs: string[], inheritedType: string | undefined): void => {
        const type = typeof node.$type === 'string' ? node.$type : inheritedType
        for (const [key, child] of Object.entries(node)) {
          if (key.startsWith('$') && key !== '$root') continue
          const childSegs = [...segs, key]
          const path = joinPath(childSegs)
          if (!isObject(child)) {
            error('not-an-object', 'tokens and groups must be JSON objects', path)
            continue
          }
          if ('$value' in child) setToken(child, path, typeof child.$type === 'string' ? child.$type : type)
          else walk(child, childSegs, type)
        }
      }
      walk(content, [], undefined)
    }

    const parsed = parseTokens(overlaid)
    for (const issue of parsed.issues) {
      // Problems of the token files themselves are reported once, by the register.
      if (baseIssues.has(issueKey(issue))) continue
      issues.push({
        ...issue,
        file: (issue.path !== undefined ? set.get(issue.path) : undefined) ?? issue.file,
        message: `in context ${context}: ${issue.message}`,
      })
    }
    tokens.set(context, parsed.tokens)
    own.set(context, set)
  }

  return {
    modes: {
      modifier: model.modifier,
      default: model.default,
      contexts: model.contexts,
      files: model.files,
      tokens,
      own,
    },
    issues,
  }
}

interface HasModes {
  tokens: Map<string, Token>
  modes?: RegisterModes | undefined
}

/** The contexts other than the default, in the resolver's order. Empty without modes. */
export const otherContexts = (register: { modes?: RegisterModes | undefined }): string[] =>
  register.modes ? register.modes.contexts.filter((c) => c !== register.modes?.default) : []

/** Context name from `{ theme: 'dark' }` or `'dark'`; undefined means the default context. */
function contextName(
  register: { modes?: RegisterModes | undefined },
  context: ModeContext | string | undefined,
): string | undefined {
  if (context === undefined || !register.modes) return undefined
  const name = typeof context === 'string' ? context : context[register.modes.modifier]
  return name === register.modes.default ? undefined : name
}

/** The register's tokens as they resolve in `context` (default context: the token files). */
export function tokensInContext(
  register: HasModes,
  context: ModeContext | string | undefined,
): Map<string, Token> {
  const name = contextName(register, context)
  return (name !== undefined ? register.modes?.tokens.get(name) : undefined) ?? register.tokens
}

/** The register seen in one context: same rules, owners and contracts, the tokens resolved there. */
export function registerInContext<R extends HasModes>(
  register: R,
  context: ModeContext | string | undefined,
): R {
  const tokens = tokensInContext(register, context)
  return tokens === register.tokens ? register : { ...register, tokens }
}

/** Whether the context sets `path` itself (its own value), as opposed to falling back to the default. */
export function setsInContext(
  register: { modes?: RegisterModes | undefined },
  context: ModeContext | string | undefined,
  path: string,
): boolean {
  const name = contextName(register, context)
  return name !== undefined && register.modes?.own.get(name)?.has(path) === true
}

/**
 * The register context a design tool's mode or theme value stands for: `Dark` → `dark`, `High contrast` →
 * `high-contrast`, `Hell`/`Dunkel` → `light`/`dark`. Undefined when the register has no such context.
 */
export function contextForMode(
  register: { modes?: RegisterModes | undefined },
  mode: string,
): string | undefined {
  if (!register.modes) return undefined
  const name = mode
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/^hell$/, 'light')
    .replace(/^dunkel$/, 'dark')
  return register.modes.contexts.find((c) => c.toLowerCase() === name)
}

/** `{ theme: 'dark' }` for a context name of this register. */
export const modeContext = (register: { modes?: RegisterModes | undefined }, name: string): ModeContext => ({
  [register.modes?.modifier ?? THEME_MODIFIER]: name,
})
