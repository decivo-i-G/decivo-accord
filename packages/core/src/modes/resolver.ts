import { z } from 'zod'
import type { Issue } from '../issues.js'

/**
 * Light/dark (and later other) contexts of the register, written in the DTCG Resolver Module 2025.10:
 * *sets* of token files, *modifiers* with *contexts*, and a `resolutionOrder` that applies them in turn.
 *
 *   .accord/
 *     tokens/*.tokens.json            the default context (e.g. light), unchanged
 *     modes/theme/dark.tokens.json    only the tokens that differ in the context "dark"
 *     resolver.json                   set "core" + modifier "theme" (light | dark, default light)
 *
 * Accord reads the subset it can act on (F13): any number of sets made of the files under `tokens/`, then
 * one modifier, `theme`, with any number of contexts. The default context has no sources of its own (its
 * values are the token files); every other context lists the files that override them. The format already
 * carries more modifiers (brand, density); Accord reports them as not supported yet instead of ignoring them.
 */
export const RESOLVER_FILE = 'resolver.json'
export const RESOLVER_VERSION = '2025.10'
/** The one modifier Accord resolves today (F13). */
export const THEME_MODIFIER = 'theme'

/** Values of the modifiers that pick a context, e.g. `{ theme: 'dark' }`. */
export type ModeContext = Record<string, string>

const RefSchema = z.object({ $ref: z.string().min(1) }).strict()
/** A source is a reference to a token file or an inline token document. */
const SourceSchema = z.union([RefSchema, z.record(z.string(), z.unknown())])

const SetSchema = z.looseObject({
  description: z.string().optional(),
  sources: z.array(SourceSchema),
  $extensions: z.record(z.string(), z.unknown()).optional(),
})

const ModifierSchema = z.looseObject({
  description: z.string().optional(),
  contexts: z.record(z.string(), z.array(SourceSchema)),
  default: z.string().optional(),
  $extensions: z.record(z.string(), z.unknown()).optional(),
})

export const ResolverSchema = z.looseObject({
  $schema: z.string().optional(),
  name: z.string().optional(),
  version: z.literal(RESOLVER_VERSION),
  description: z.string().optional(),
  sets: z.record(z.string(), SetSchema).default({}),
  modifiers: z.record(z.string(), ModifierSchema).default({}),
  /** References (`#/sets/core`, `#/modifiers/theme`) or inline sets and modifiers. */
  resolutionOrder: z.array(z.union([RefSchema, z.record(z.string(), z.unknown())])).min(1),
  $extensions: z.record(z.string(), z.unknown()).optional(),
})

export type ResolverDocument = z.infer<typeof ResolverSchema>

/** What Accord takes from a valid resolver document. */
export interface ResolverModel {
  /** Token files of the sets, in resolution order (register-relative, e.g. `tokens/color.tokens.json`). */
  setFiles: string[]
  /** The modifier the contexts belong to (`theme`). */
  modifier: string
  /** All contexts in the order the resolver declares them, the default one included. */
  contexts: string[]
  default: string
  /** Files per non-default context, in order; later files win. */
  files: Map<string, string[]>
}

/** Context names end up in file names and keys like `theme=dark`. */
const CONTEXT_NAME = /^[A-Za-z0-9][\w-]*$/

/** Register-relative path of a `$ref` written relative to `resolver.json` at the register root. */
export function refPath(ref: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('/') || ref.includes('#')) return undefined
  const parts: string[] = []
  for (const seg of ref.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (parts.length === 0) return undefined
      parts.pop()
    } else parts.push(seg)
  }
  return parts.join('/') || undefined
}

const isRef = (v: unknown): v is { $ref: string } =>
  typeof v === 'object' && v !== null && typeof (v as { $ref?: unknown }).$ref === 'string'

/**
 * Read and check `resolver.json`. Returns the model only when Accord can resolve it; everything that keeps it
 * from doing so is an error, so no check runs on contexts it misread. `exists` tells whether a register file is there.
 */
export function readResolver(
  content: string,
  exists: (path: string) => boolean,
  isTokenFile: (path: string) => boolean,
): { model?: ResolverModel | undefined; issues: Issue[] } {
  const issues: Issue[] = []
  const error = (code: string, message: string, path?: string) =>
    issues.push({ severity: 'error', code, file: RESOLVER_FILE, message, ...(path ? { path } : {}) })
  const warning = (code: string, message: string, path?: string) =>
    issues.push({ severity: 'warning', code, file: RESOLVER_FILE, message, ...(path ? { path } : {}) })

  let json: unknown
  try {
    json = JSON.parse(content)
  } catch (e) {
    error('json', (e as Error).message)
    return { issues }
  }
  const parsed = ResolverSchema.safeParse(json)
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      error('schema', issue.message, issue.path.map(String).join('.') || undefined)
    return { issues }
  }
  const doc = parsed.data

  const fileOf = (source: unknown, where: string): string | undefined => {
    if (!isRef(source)) {
      error(
        'resolver-inline-source',
        'inline sources are not supported; reference a token file instead',
        where,
      )
      return undefined
    }
    const path = refPath(source.$ref)
    if (!path) {
      error(
        'resolver-ref',
        `${source.$ref} must be a file inside the register (no URL, no JSON pointer)`,
        where,
      )
      return undefined
    }
    if (!exists(path)) {
      error('resolver-missing-file', `${source.$ref} does not exist`, where)
      return undefined
    }
    return path
  }

  // Order: every set first, then the theme modifier.
  const order: { kind: 'set' | 'modifier'; name: string }[] = []
  doc.resolutionOrder.forEach((entry, i) => {
    const where = `resolutionOrder.${i}`
    if (!isRef(entry)) {
      error('resolver-inline-order', 'inline sets and modifiers are not supported; reference them', where)
      return
    }
    const match = /^#\/(sets|modifiers)\/(.+)$/.exec(entry.$ref)
    const kind = match?.[1] === 'sets' ? 'set' : 'modifier'
    const name = match?.[2]?.replace(/~1/g, '/').replace(/~0/g, '~')
    if (!match || name === undefined || !(name in (kind === 'set' ? doc.sets : doc.modifiers))) {
      error('resolver-ref', `${entry.$ref} does not point to a set or modifier of this file`, where)
      return
    }
    order.push({ kind, name })
  })

  const setFiles: string[] = []
  for (const name of Object.keys(doc.sets)) {
    if (!order.some((o) => o.kind === 'set' && o.name === name))
      warning('resolver-unused', `set ${name} is not in resolutionOrder and does not apply`, `sets.${name}`)
  }
  for (const entry of order.filter((o) => o.kind === 'set')) {
    const set = doc.sets[entry.name] as ResolverDocument['sets'][string]
    set.sources.forEach((source, i) => {
      const file = fileOf(source, `sets.${entry.name}.sources.${i}`)
      if (file === undefined) return
      if (!isTokenFile(file))
        error(
          'resolver-set-file',
          `${file}: sets hold the token files under tokens/; context values go into a modifier`,
          `sets.${entry.name}.sources.${i}`,
        )
      else if (!setFiles.includes(file)) setFiles.push(file)
    })
  }

  for (const name of Object.keys(doc.modifiers)) {
    if (name !== THEME_MODIFIER)
      error(
        'resolver-unsupported-modifier',
        `modifier ${name} is not supported yet; Accord resolves the modifier "${THEME_MODIFIER}" only`,
        `modifiers.${name}`,
      )
  }
  const modifier = doc.modifiers[THEME_MODIFIER]
  if (!modifier) return { issues }

  const position = order.findIndex((o) => o.kind === 'modifier' && o.name === THEME_MODIFIER)
  if (position === -1)
    error('resolver-order', `modifier ${THEME_MODIFIER} is not in resolutionOrder`, 'resolutionOrder')
  else if (order.slice(position + 1).some((o) => o.kind === 'set'))
    error(
      'resolver-order',
      `the modifier ${THEME_MODIFIER} must come after every set: its contexts override the token files`,
      'resolutionOrder',
    )

  const contexts = Object.keys(modifier.contexts)
  const at = `modifiers.${THEME_MODIFIER}`
  if (contexts.length === 0) error('resolver-contexts', 'the modifier has no contexts', `${at}.contexts`)
  for (const name of contexts)
    if (!CONTEXT_NAME.test(name))
      error(
        'resolver-context-name',
        `context name "${name}" may only use letters, digits, "-" and "_"`,
        `${at}.contexts`,
      )
  let fallback = modifier.default
  if (fallback === undefined) {
    fallback = contexts[0]
    if (fallback !== undefined)
      warning('resolver-default', `no default context; using the first one, ${fallback}`, `${at}.default`)
  } else if (!contexts.includes(fallback))
    error('resolver-default', `default ${fallback} is not one of the contexts`, `${at}.default`)

  const files = new Map<string, string[]>()
  for (const [name, sources] of Object.entries(modifier.contexts)) {
    const list: string[] = []
    sources.forEach((source, i) => {
      const file = fileOf(source, `${at}.contexts.${name}.${i}`)
      if (file === undefined) return
      if (isTokenFile(file))
        error(
          'resolver-context-file',
          `${file} is a token file of the default context; put the ${name} values under modes/${THEME_MODIFIER}/`,
          `${at}.contexts.${name}.${i}`,
        )
      else list.push(file)
    })
    if (name === fallback) {
      if (sources.length > 0)
        error(
          'resolver-default-sources',
          `the default context ${name} takes its values from tokens/; it must not list sources`,
          `${at}.contexts.${name}`,
        )
      continue
    }
    files.set(name, list)
  }
  const used = new Map<string, string>()
  for (const [name, list] of files)
    for (const file of list) {
      const other = used.get(file)
      if (other && other !== name)
        error('resolver-context-file', `${file} is used by the contexts ${other} and ${name}`, at)
      used.set(file, name)
    }

  if (issues.some((i) => i.severity === 'error') || fallback === undefined) return { issues }
  return { model: { setFiles, modifier: THEME_MODIFIER, contexts, default: fallback, files }, issues }
}

/** Canonical key of a context, as used in snapshots and the lock: `theme=dark`. */
export const contextKey = (context: ModeContext): string =>
  Object.keys(context)
    .sort()
    .map((k) => `${k}=${context[k]}`)
    .join(',')

/** `theme=dark` → `{ theme: 'dark' }`. */
export function parseContextKey(key: string): ModeContext {
  const out: ModeContext = {}
  for (const part of key.split(',')) {
    const [k, v] = part.split('=')
    if (k && v) out[k] = v
  }
  return out
}

/** Short label for people: `dark` (the modifier is implied while there is only one). */
export const contextLabel = (context: ModeContext): string => Object.values(context).join('/')

/** The resolver document `accord init` writes: one set with the token files, the modifier `theme`. */
export function resolverDocument(input: {
  tokenFiles: readonly string[]
  contexts: readonly string[]
  default: string
  /** File per non-default context, register-relative. */
  files: ReadonlyMap<string, string>
  description?: string | undefined
}): ResolverDocument {
  return {
    version: RESOLVER_VERSION,
    ...(input.description ? { description: input.description } : {}),
    sets: { core: { sources: input.tokenFiles.map((f) => ({ $ref: f })) } },
    modifiers: {
      [THEME_MODIFIER]: {
        contexts: Object.fromEntries(
          input.contexts.map((c) => {
            const file = input.files.get(c)
            return [c, c === input.default || !file ? [] : [{ $ref: file }]]
          }),
        ),
        default: input.default,
      },
    },
    resolutionOrder: [{ $ref: '#/sets/core' }, { $ref: `#/modifiers/${THEME_MODIFIER}` }],
  }
}

/** Conventional file of a context: `modes/theme/dark.tokens.json`. */
export const contextFile = (context: string, modifier = THEME_MODIFIER) =>
  `modes/${modifier}/${context}.tokens.json`
