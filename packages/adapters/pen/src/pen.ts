import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  cssVariableName,
  type VariableSurfaceStatus,
  variableSurfaceStatus,
} from '@decivo/accord-adapter-code'
import type { Lock, Register, Token } from '@decivo/accord-core'
import { type ParseError, parse } from 'jsonc-parser'
import { glob } from 'tinyglobby'

/**
 * Pencil (pen.dev) stores designs as `.pen` files in the repository: a JSON object tree (comments allowed)
 * with document-wide `variables` and theme axes in `themes`. The format is still moving, so Accord only
 * reads what it needs (variables, themes, literal colours in nodes) and ignores everything else.
 */
export interface PenVariable {
  name: string
  type: string
  /** Value under the default theme (first value of every axis), references resolved. */
  value: string | number | undefined
  /** Values that differ from the default in a single other theme context, e.g. `{ mode: 'dark' }`. */
  themed: { theme: Record<string, string>; value: string | number }[]
  file: string
}

export interface PenLiteral {
  /** Lowercase hex colour used directly on a node instead of a variable. */
  value: string
  count: number
  /** Node ids where it occurs (first ones only). */
  nodes: string[]
  files: string[]
}

export interface PenDocument {
  path: string
  variables: PenVariable[]
  themes: Record<string, string[]>
  literals: PenLiteral[]
  errors: string[]
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

type RawValue = string | number | boolean
interface ThemedEntry {
  value: RawValue
  theme?: Record<string, string> | undefined
}

function entries(raw: unknown): ThemedEntry[] {
  if (Array.isArray(raw))
    return raw.filter(isObj).map((e) => ({
      value: e.value as RawValue,
      theme: isObj(e.theme) ? (e.theme as Record<string, string>) : undefined,
    }))
  return [{ value: raw as RawValue }]
}

/** The last entry whose theme matches `context` wins, as in pen.dev. */
function pick(raw: unknown, context: Record<string, string>): RawValue | undefined {
  let found: RawValue | undefined
  for (const e of entries(raw))
    if (!e.theme || Object.entries(e.theme).every(([axis, v]) => context[axis] === v)) found = e.value
  return found
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const MAX_NODES = 5

/** Read one `.pen` document. Never throws: what cannot be read is listed in `errors`. */
export function parsePen(text: string, path: string): PenDocument {
  const errors: ParseError[] = []
  const doc = parse(text, errors, { allowTrailingComma: true }) as unknown
  const out: PenDocument = { path, variables: [], themes: {}, literals: [], errors: [] }
  if (errors.length > 0 || !isObj(doc)) {
    out.errors.push(`${path}: not a readable .pen document`)
    return out
  }

  if (isObj(doc.themes))
    for (const [axis, values] of Object.entries(doc.themes))
      if (Array.isArray(values)) out.themes[axis] = values.map(String)
  const defaults = Object.fromEntries(
    Object.entries(out.themes).flatMap(([axis, values]) => (values[0] ? [[axis, values[0]]] : [])),
  )

  const raw = isObj(doc.variables) ? doc.variables : {}
  const resolve = (value: RawValue | undefined, context: Record<string, string>, depth = 0) => {
    let v = value
    while (typeof v === 'string' && v.startsWith('$') && depth++ < 10) {
      const target = raw[v.slice(1)]
      v = isObj(target) ? pick(target.value, context) : undefined
    }
    return typeof v === 'boolean' ? undefined : v
  }
  for (const [name, def] of Object.entries(raw)) {
    if (!isObj(def)) continue
    const value = resolve(pick(def.value, defaults), defaults)
    const themed: PenVariable['themed'] = []
    for (const [axis, values] of Object.entries(out.themes))
      for (const other of values.slice(1)) {
        const context = { ...defaults, [axis]: other }
        const v = resolve(pick(def.value, context), context)
        if (v !== undefined && v !== value) themed.push({ theme: { [axis]: other }, value: v })
      }
    out.variables.push({ name, type: String(def.type ?? ''), value, themed, file: path })
  }

  const literals = new Map<string, PenLiteral>()
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!isObj(node)) return
    for (const [key, v] of Object.entries(node)) {
      if (key === 'variables' || key === 'themes') continue
      if (typeof v === 'string' && HEX.test(v)) {
        const hex = v.toLowerCase()
        const entry = literals.get(hex) ?? { value: hex, count: 0, nodes: [], files: [path] }
        entry.count++
        if (typeof node.id === 'string' && entry.nodes.length < MAX_NODES && !entry.nodes.includes(node.id))
          entry.nodes.push(node.id)
        literals.set(hex, entry)
      } else walk(v)
    }
  }
  walk(doc.children)
  out.literals = [...literals.values()].sort((a, b) => b.count - a.count)
  return out
}

/** All `.pen` files of the repository, read and parsed. */
export async function readPenFiles(
  root: string,
  include: readonly string[] = ['**/*.pen'],
): Promise<PenDocument[]> {
  const paths = await glob([...include], { cwd: root, ignore: ['**/node_modules/**', '**/.git/**'] })
  const docs: PenDocument[] = []
  for (const path of paths.sort()) docs.push(parsePen(await readFile(join(root, path), 'utf8'), path))
  return docs
}

/** Names a token may have in Pencil: `ids.pen`, its register path, or its CSS variable (with or without `--`). */
export const penVariableNames = (token: Token): string[] => [
  ...(token.accord?.ids?.pen ? [token.accord.ids.pen] : []),
  token.path,
  cssVariableName(token),
  cssVariableName(token).replace(/^--/, ''),
]

export interface PenStatus extends VariableSurfaceStatus {
  literals: PenLiteral[]
  errors: string[]
}

/** Compare the Pencil files with the register. Only tokens Pencil defines are compared. */
export function penStatus(docs: readonly PenDocument[], register: Register, lock: Lock): PenStatus {
  const status = variableSurfaceStatus({
    surface: 'pen',
    variables: docs.flatMap((d) => d.variables),
    register,
    lock,
    names: penVariableNames,
    // Theme values besides each axis' default (mode: dark); those the register has as contexts are compared.
    modes: [...new Set(docs.flatMap((d) => Object.values(d.themes).flatMap((values) => values.slice(1))))],
  })

  const literals = new Map<string, PenLiteral>()
  for (const doc of docs)
    for (const l of doc.literals) {
      const entry = literals.get(l.value)
      if (!entry) literals.set(l.value, { ...l, nodes: [...l.nodes], files: [...l.files] })
      else {
        entry.count += l.count
        entry.nodes.push(...l.nodes.slice(0, MAX_NODES - entry.nodes.length))
        if (!entry.files.includes(doc.path)) entry.files.push(doc.path)
      }
    }

  return {
    ...status,
    literals: [...literals.values()].sort((a, b) => b.count - a.count),
    errors: docs.flatMap((d) => d.errors),
  }
}
