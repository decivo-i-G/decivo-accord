import { joinPath, splitPath } from '../paths.js'
import { aliasTarget } from './parse.js'
import type { Group, Token, TokenType } from './types.js'

type Obj = Record<string, unknown>

/** Type a token would get without its own `$type`: from its alias target, else the closest group. */
function inheritedType(
  token: Token,
  tokens: ReadonlyMap<string, Token>,
  groups: ReadonlyMap<string, Group>,
): TokenType | undefined {
  const alias = aliasTarget(token.rawValue)
  if (alias !== undefined) {
    const target = tokens.get(alias)
    if (target) return target.type
  }
  return groups.get(joinPath(splitPath(token.path).slice(0, -1)))?.effectiveType
}

function inheritedDeprecated(path: string, groups: ReadonlyMap<string, Group>): boolean | string | undefined {
  const segs = splitPath(path)
  for (let i = segs.length - 1; i >= 0; i--) {
    const deprecated = groups.get(joinPath(segs.slice(0, i)))?.deprecated
    if (deprecated !== undefined) return deprecated
  }
  return undefined
}

function groupProps(group: Group): Obj {
  const out: Obj = {}
  if (group.type) out.$type = group.type
  if (group.description !== undefined) out.$description = group.description
  if (group.deprecated !== undefined) out.$deprecated = group.deprecated
  if (group.extends !== undefined) out.$extends = group.extends
  if (group.extensions) out.$extensions = group.extensions
  return out
}

/**
 * Write tokens back as DTCG documents, one per source file. Tokens inherited through `$extends`
 * are left out (the group keeps its `$extends`), and `$type`/`$deprecated` are only written where
 * they are not already implied by a group or alias. Unknown `$extensions` are preserved.
 */
export function serializeTokens(
  tokens: ReadonlyMap<string, Token>,
  groups: ReadonlyMap<string, Group>,
): Map<string, Obj> {
  const docs = new Map<string, Obj>()
  const docFor = (file: string): Obj => {
    let doc = docs.get(file)
    if (!doc) {
      doc = {}
      const root = groups.get('')
      if (root && (root.file === file || docs.size === 0)) Object.assign(doc, groupProps(root))
      docs.set(file, doc)
    }
    return doc
  }

  const ensureGroup = (doc: Obj, segs: string[], file: string): Obj => {
    let node = doc
    for (let i = 0; i < segs.length; i++) {
      const key = segs[i] as string
      if (!node[key]) {
        const group = groups.get(joinPath(segs.slice(0, i + 1)))
        node[key] = group && group.file === file ? groupProps(group) : {}
      }
      node = node[key] as Obj
    }
    return node
  }

  for (const token of tokens.values()) {
    if (token.inheritedFrom !== undefined) continue
    const segs = splitPath(token.path)
    const name = segs.pop() as string
    const parent = ensureGroup(docFor(token.file), segs, token.file)
    const out: Obj = {}
    if (token.type !== inheritedType(token, tokens, groups)) out.$type = token.type
    out.$value = token.rawValue
    if (token.description !== undefined) out.$description = token.description
    if (token.deprecated !== undefined && token.deprecated !== inheritedDeprecated(token.path, groups)) {
      out.$deprecated = token.deprecated
    }
    if (token.extensions) out.$extensions = token.extensions
    parent[name] = out
  }

  // Groups without tokens of their own (e.g. only `$extends`) still need to be written.
  for (const group of groups.values()) {
    if (group.path === '' || group.inherited) continue
    const segs = splitPath(group.path)
    ensureGroup(docFor(group.file), segs, group.file)
  }

  return docs
}
