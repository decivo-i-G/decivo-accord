import type { Issue } from '../issues.js'
import { joinPath, splitPath } from '../paths.js'
import {
  ACCORD_EXTENSION_KEY,
  type AccordExtension,
  type Group,
  OWNERS,
  type Owner,
  type Token,
  type TokenType,
} from './types.js'
import { isTokenType, validateValue } from './validate.js'

export interface TokenFile {
  /** Path relative to the register root, e.g. `tokens/color.tokens.json`. */
  file: string
  content: unknown
}

export interface ParsedTokens {
  tokens: Map<string, Token>
  groups: Map<string, Group>
  issues: Issue[]
}

type Obj = Record<string, unknown>

const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const CURLY_REF = /^\{([^{}]+)\}$/
const GROUP_PROPS = new Set(['$type', '$description', '$extensions', '$deprecated', '$extends'])
const TOKEN_PROPS = new Set(['$value', '$type', '$description', '$extensions', '$deprecated'])

/** Returns the referenced token path if `value` is a whole-value curly-brace alias. */
export function aliasTarget(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return CURLY_REF.exec(value)?.[1]
}

function invalidName(name: string): string | undefined {
  if (name === '$root') return undefined
  if (name.startsWith('$')) return `name "${name}" must not start with "$"`
  if (/[{}.]/.test(name)) return `name "${name}" must not contain "{", "}" or "."`
  if (name.length === 0) return 'name must not be empty'
  return undefined
}

/** Merge several token files into one tree, remembering which file each token and group came from. */
function mergeFiles(files: readonly TokenFile[], issues: Issue[]) {
  const tree: Obj = {}
  const origin = new Map<string, string>()

  const merge = (target: Obj, source: Obj, segs: string[], file: string): void => {
    for (const [key, value] of Object.entries(source)) {
      const childSegs = key.startsWith('$') && key !== '$root' ? segs : [...segs, key]
      if (key.startsWith('$') && key !== '$root') {
        if (key === '$extensions' && isObject(target[key]) && isObject(value)) {
          target[key] = { ...(target[key] as Obj), ...value }
        } else if (target[key] !== undefined && JSON.stringify(target[key]) !== JSON.stringify(value)) {
          issues.push({
            severity: 'error',
            code: 'conflicting-group-property',
            file,
            path: joinPath(segs),
            message: `${key} differs from the definition in ${origin.get(joinPath(segs)) ?? 'another file'}`,
          })
        } else target[key] = value
        continue
      }
      const path = joinPath(childSegs)
      if (!isObject(value)) {
        issues.push({
          severity: 'error',
          code: 'not-an-object',
          file,
          path,
          message: 'tokens and groups must be JSON objects',
        })
        continue
      }
      const existing = target[key]
      if (existing === undefined) {
        target[key] = '$value' in value ? value : {}
        origin.set(path, file)
        if (!('$value' in value)) merge(target[key] as Obj, value, childSegs, file)
      } else if ('$value' in value || (isObject(existing) && '$value' in existing)) {
        issues.push({
          severity: 'error',
          code: 'duplicate-token',
          file,
          path,
          message: `already defined in ${origin.get(path)}`,
        })
      } else {
        merge(existing as Obj, value, childSegs, file)
      }
    }
  }

  for (const { file, content } of files) {
    if (!isObject(content)) {
      issues.push({
        severity: 'error',
        code: 'not-an-object',
        file,
        message: 'a token file must contain a JSON object',
      })
      continue
    }
    merge(tree, content, [], file)
  }
  return { tree, origin }
}

function getAtPath(tree: Obj, path: string): unknown {
  let node: unknown = tree
  for (const seg of splitPath(path)) {
    if (!isObject(node)) return undefined
    node = node[seg]
  }
  return node
}

function deepClone<T>(v: T): T {
  return structuredClone(v)
}

/**
 * Expand `$extends` in place: the extended group's children and properties are copied in,
 * local definitions win. Copied tokens are marked so the serializer can leave them out.
 */
function expandExtends(tree: Obj, issues: Issue[], origin: Map<string, string>) {
  const inherited = new Map<string, string>() // token path → path of the token it was copied from
  const inheritedGroups = new Set<string>()
  const copiedProps = new Map<string, Set<string>>() // group path → $-properties taken from the base
  const done = new Set<string>()

  const expand = (node: Obj, path: string, stack: string[]): void => {
    if (done.has(path)) return
    if (stack.includes(path)) {
      issues.push({
        severity: 'error',
        code: 'extends-cycle',
        file: origin.get(path),
        path,
        message: `$extends cycle: ${[...stack, path].join(' → ')}`,
      })
      return
    }
    const ref = node.$extends
    if (ref !== undefined) {
      const target = aliasTarget(ref)
      const base = target === undefined ? undefined : getAtPath(tree, target)
      if (target === undefined || !isObject(base) || '$value' in base) {
        issues.push({
          severity: 'error',
          code: 'extends-invalid',
          file: origin.get(path),
          path,
          message: `$extends must reference a group like "{button}", got ${JSON.stringify(ref)}`,
        })
      } else {
        expand(base, target, [...stack, path])
        const mergeBase = (into: Obj, from: Obj, intoPath: string, fromPath: string): void => {
          for (const [key, value] of Object.entries(from)) {
            if (key === '$extends') continue
            if (key.startsWith('$') && key !== '$root') {
              if (into[key] === undefined) {
                into[key] = deepClone(value)
                const copied = copiedProps.get(intoPath) ?? new Set<string>()
                copied.add(key)
                copiedProps.set(intoPath, copied)
              }
              continue
            }
            const childPath = intoPath ? `${intoPath}.${key}` : key
            const fromChild = fromPath ? `${fromPath}.${key}` : key
            if (into[key] === undefined) {
              into[key] = deepClone(value)
              markInherited(into[key], childPath, fromChild)
            } else if (
              isObject(into[key]) &&
              !('$value' in (into[key] as Obj)) &&
              isObject(value) &&
              !('$value' in value)
            ) {
              mergeBase(into[key] as Obj, value, childPath, fromChild)
            }
          }
        }
        const markInherited = (value: unknown, at: string, from: string): void => {
          if (!isObject(value)) return
          if ('$value' in value) {
            inherited.set(at, from)
            origin.set(at, origin.get(from) ?? origin.get(path) ?? '')
            return
          }
          inheritedGroups.add(at)
          origin.set(at, origin.get(path) ?? '')
          for (const [key, child] of Object.entries(value)) {
            if (!key.startsWith('$') || key === '$root')
              markInherited(child, `${at}.${key}`, `${from}.${key}`)
          }
        }
        mergeBase(node, base, path, target)
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith('$') && key !== '$root') continue
      if (isObject(child) && !('$value' in child))
        expand(child, path ? `${path}.${key}` : key, [...stack, path])
    }
    done.add(path)
  }

  expand(tree, '', [])
  return { inherited, inheritedGroups, copiedProps }
}

function readAccord(extensions: unknown, file: string | undefined, path: string, issues: Issue[]) {
  if (!isObject(extensions)) return undefined
  const raw = extensions[ACCORD_EXTENSION_KEY]
  if (raw === undefined) return undefined
  if (!isObject(raw)) {
    issues.push({
      severity: 'error',
      code: 'accord-extension',
      file,
      path,
      message: `${ACCORD_EXTENSION_KEY} must be an object`,
    })
    return undefined
  }
  const out: AccordExtension = {}
  if (raw.owner !== undefined) {
    if (OWNERS.includes(raw.owner as Owner)) out.owner = raw.owner as Owner
    else
      issues.push({
        severity: 'error',
        code: 'accord-owner',
        file,
        path,
        message: `owner must be one of ${OWNERS.join(', ')}, got ${JSON.stringify(raw.owner)}`,
      })
  }
  if (raw.decisions !== undefined) {
    if (Array.isArray(raw.decisions) && raw.decisions.every((d) => typeof d === 'string'))
      out.decisions = raw.decisions
    else
      issues.push({
        severity: 'error',
        code: 'accord-decisions',
        file,
        path,
        message: 'decisions must be a list of ids',
      })
  }
  if (isObject(raw.ids)) out.ids = raw.ids as AccordExtension['ids'] & object
  if (typeof raw.css === 'string') out.css = raw.css
  else if (isObject(raw.css) && Object.values(raw.css).every((v) => typeof v === 'string')) {
    out.css = raw.css as Record<string, string>
  }
  return out
}

/**
 * Parse one or more DTCG 2025.10 token files into a flat token map.
 * References are resolved across all files, types are inherited from groups and aliases,
 * and every resolved value is validated against its type.
 */
export function parseTokens(files: readonly TokenFile[]): ParsedTokens {
  const issues: Issue[] = []
  const { tree, origin } = mergeFiles(files, issues)
  const { inherited, inheritedGroups, copiedProps } = expandExtends(tree, issues, origin)

  const tokens = new Map<string, Token>()
  const groups = new Map<string, Group>()
  const rawTypes = new Map<string, TokenType | undefined>()
  const groupTypeOf = new Map<string, TokenType | undefined>()
  const groupDeprecatedOf = new Map<string, boolean | string | undefined>()

  const walkGroup = (
    node: Obj,
    segs: string[],
    inheritedType: TokenType | undefined,
    inheritedDeprecated: boolean | string | undefined,
  ): void => {
    const path = joinPath(segs)
    const file = origin.get(path) ?? files[0]?.file ?? ''
    for (const key of Object.keys(node)) {
      if (key.startsWith('$') && key !== '$root' && !GROUP_PROPS.has(key)) {
        issues.push({
          severity: 'warning',
          code: 'unknown-property',
          file,
          path,
          message: `unknown group property ${key}`,
        })
      }
    }
    let type = inheritedType
    if (node.$type !== undefined) {
      if (isTokenType(node.$type)) type = node.$type
      else
        issues.push({
          severity: 'error',
          code: 'unknown-type',
          file,
          path,
          message: `unknown $type ${JSON.stringify(node.$type)}`,
        })
    }
    const deprecated = (node.$deprecated as boolean | string | undefined) ?? inheritedDeprecated
    // Properties copied in from an `$extends` base still apply, but are not written back.
    const own = (key: string) => node[key] !== undefined && !copiedProps.get(path)?.has(key)
    const group: Group = { path, file }
    if (own('$type') && isTokenType(node.$type)) group.type = node.$type
    if (type) group.effectiveType = type
    if (own('$description') && typeof node.$description === 'string') group.description = node.$description
    if (own('$deprecated')) group.deprecated = node.$deprecated as boolean | string
    if (own('$extensions') && isObject(node.$extensions)) group.extensions = node.$extensions
    if (typeof node.$extends === 'string') group.extends = node.$extends
    if (inheritedGroups.has(path)) group.inherited = true
    const accord = readAccord(node.$extensions, file, path, issues)
    if (accord) group.accord = accord
    groups.set(path, group)

    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith('$') && key !== '$root') continue
      const childSegs = [...segs, key]
      const childPath = joinPath(childSegs)
      const problem = invalidName(key)
      if (problem) {
        issues.push({
          severity: 'error',
          code: 'invalid-name',
          file: origin.get(childPath) ?? file,
          path: childPath,
          message: problem,
        })
        continue
      }
      if (!isObject(child)) continue
      if ('$value' in child) {
        groupTypeOf.set(childPath, type)
        groupDeprecatedOf.set(childPath, deprecated)
        readToken(child, childPath)
      } else if (key === '$root') {
        issues.push({
          severity: 'error',
          code: 'invalid-root',
          file,
          path: childPath,
          message: '$root must be a token',
        })
      } else walkGroup(child, childSegs, type, deprecated)
    }
  }

  const readToken = (node: Obj, path: string): void => {
    const file = origin.get(path) ?? ''
    for (const key of Object.keys(node)) {
      if (key.startsWith('$') && !TOKEN_PROPS.has(key)) {
        issues.push({
          severity: 'warning',
          code: 'unknown-property',
          file,
          path,
          message: `unknown token property ${key}`,
        })
      }
    }
    let explicit: TokenType | undefined
    if (node.$type !== undefined) {
      if (isTokenType(node.$type)) explicit = node.$type
      else
        issues.push({
          severity: 'error',
          code: 'unknown-type',
          file,
          path,
          message: `unknown $type ${JSON.stringify(node.$type)}`,
        })
    }
    rawTypes.set(path, explicit)
    const token: Token = { path, type: 'number', rawValue: node.$value, value: undefined, file }
    const alias = aliasTarget(node.$value)
    if (alias !== undefined) token.aliasOf = alias
    if (typeof node.$description === 'string') token.description = node.$description
    const deprecated = (node.$deprecated as boolean | string | undefined) ?? groupDeprecatedOf.get(path)
    if (deprecated !== undefined && deprecated !== false) token.deprecated = deprecated
    if (isObject(node.$extensions)) token.extensions = node.$extensions
    const accord = readAccord(node.$extensions, file, path, issues)
    if (accord) token.accord = accord
    const from = inherited.get(path)
    if (from !== undefined) token.inheritedFrom = from
    tokens.set(path, token)
  }

  walkGroup(tree, [], undefined, undefined)

  // Pass 2: types. Explicit $type, then the aliased token's type, then the closest group's.
  const resolveType = (path: string, stack: string[]): TokenType | undefined => {
    const explicit = rawTypes.get(path)
    if (explicit) return explicit
    const token = tokens.get(path)
    if (token?.aliasOf !== undefined && tokens.has(token.aliasOf) && !stack.includes(token.aliasOf)) {
      const viaAlias = resolveType(token.aliasOf, [...stack, path])
      if (viaAlias) return viaAlias
    }
    return groupTypeOf.get(path)
  }
  const untyped = new Set<string>()
  for (const token of tokens.values()) {
    const type = resolveType(token.path, [])
    if (type) token.type = type
    else {
      untyped.add(token.path)
      issues.push({
        severity: 'error',
        code: 'missing-type',
        file: token.file,
        path: token.path,
        message: 'no $type on the token, its alias target or any parent group',
      })
    }
  }

  // Pass 3: values. Resolve curly-brace aliases and JSON Pointer $ref, then validate.
  const resolving = new Set<string>()
  const resolvedCache = new Map<string, { ok: boolean; value: unknown }>()

  const resolveToken = (path: string, from: Token): { ok: boolean; value: unknown } => {
    const cached = resolvedCache.get(path)
    if (cached) return cached
    const target = tokens.get(path)
    if (!target) {
      issues.push({
        severity: 'error',
        code: 'broken-reference',
        file: from.file,
        path: from.path,
        message: `{${path}} does not exist`,
      })
      return { ok: false, value: undefined }
    }
    if (resolving.has(path)) {
      issues.push({
        severity: 'error',
        code: 'reference-cycle',
        file: from.file,
        path: from.path,
        message: `reference cycle through {${path}}`,
      })
      return { ok: false, value: undefined }
    }
    resolving.add(path)
    const result = resolveValue(target.rawValue, target)
    resolving.delete(path)
    resolvedCache.set(path, result)
    return result
  }

  const resolvePointer = (pointer: string, from: Token): { ok: boolean; value: unknown } => {
    if (!pointer.startsWith('#/')) {
      issues.push({
        severity: 'error',
        code: 'broken-reference',
        file: from.file,
        path: from.path,
        message: `unsupported $ref ${pointer}`,
      })
      return { ok: false, value: undefined }
    }
    const parts = pointer
      .slice(2)
      .split('/')
      .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
    const valueAt = parts.indexOf('$value')
    const tokenPath = joinPath(valueAt === -1 ? parts : parts.slice(0, valueAt))
    const resolved = resolveToken(tokenPath, from)
    if (!resolved.ok) return resolved
    let node: unknown = resolved.value
    for (const part of valueAt === -1 ? [] : parts.slice(valueAt + 1)) {
      if (Array.isArray(node)) node = node[Number(part)]
      else if (isObject(node)) node = node[part]
      else node = undefined
    }
    if (node === undefined) {
      issues.push({
        severity: 'error',
        code: 'broken-reference',
        file: from.file,
        path: from.path,
        message: `$ref ${pointer} does not exist`,
      })
      return { ok: false, value: undefined }
    }
    return { ok: true, value: node }
  }

  const resolveValue = (value: unknown, owner: Token): { ok: boolean; value: unknown } => {
    const alias = aliasTarget(value)
    if (alias !== undefined) return resolveToken(alias, owner)
    if (Array.isArray(value)) {
      let ok = true
      const out = value.map((v) => {
        const r = resolveValue(v, owner)
        ok &&= r.ok
        return r.value
      })
      return { ok, value: out }
    }
    if (isObject(value)) {
      if (typeof value.$ref === 'string' && Object.keys(value).length === 1)
        return resolvePointer(value.$ref, owner)
      let ok = true
      const out: Obj = {}
      for (const [k, v] of Object.entries(value)) {
        const r = resolveValue(v, owner)
        ok &&= r.ok
        out[k] = r.value
      }
      return { ok, value: out }
    }
    return { ok: true, value }
  }

  for (const token of tokens.values()) {
    const { ok, value } = resolveToken(token.path, token)
    if (!ok) continue
    token.value = value
    if (untyped.has(token.path)) continue
    for (const problem of validateValue(token.type, value)) {
      issues.push({
        severity: 'error',
        code: 'invalid-value',
        file: token.file,
        path: token.path,
        message: problem,
      })
    }
  }

  return { tokens, groups, issues }
}
