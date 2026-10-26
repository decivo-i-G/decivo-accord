import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  cssVariableName,
  type SurfaceVariable,
  type VariableSurfaceStatus,
  variableSurfaceStatus,
} from '@decivo/accord-adapter-code'
import type { Lock, Register, Token } from '@decivo/accord-core'
import { type ParseError, parse } from 'jsonc-parser'
import { glob } from 'tinyglobby'
import { FigFileError, readFigDocument } from './fig-file.js'

/**
 * Figma variables as exported to JSON: Figma's own export (DTCG), DTCG plugins, or Tokens Studio
 * (`value`/`type`). The REST API for variables needs an Enterprise plan, so Accord reads exports that
 * live in the repository. One file per mode is common (`colors.Light.json`, `colors.Dark.json`); so are
 * top-level groups named after modes (`{ "Light": …, "Dark": … }`).
 */
export interface FigmaVariable {
  name: string
  /** The name's parts as written in Figma (`Spacing/0.5` → `["Spacing", "0.5"]`). */
  segments?: string[] | undefined
  type?: string | undefined
  value: unknown
  mode?: string | undefined
  /** Figma collection; modes belong to a collection, each with its own default. */
  collection?: string | undefined
  /** Figma scopes (`CORNER_RADIUS`, `FONT_FAMILY`, …): what a number or string is used for. */
  scopes?: string[] | undefined
  /** Name of the variable this one is an alias of. */
  alias?: string | undefined
  /** CSS variable from Figma's code syntax (`var(--eds-space-4)` → `--eds-space-4`). */
  cssVariable?: string | undefined
  file: string
}

export interface FigmaExport {
  path: string
  format: 'fig' | 'dtcg' | 'tokens-studio' | 'figma-rest' | 'figma-plugin' | 'variables2json' | 'unknown'
  variables: FigmaVariable[]
  /** Default mode per collection where the export says so (REST `defaultModeId`). */
  defaultModes?: Record<string, string> | undefined
  errors: string[]
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const REF = /^\{([^{}]+)\}$/
const NOT_READABLE = 'not a readable JSON export'
const UNKNOWN_FORMAT = 'no variables found (not a known Figma export format)'
const MODE_NAME = /^(light|dark|default|hell|dunkel|mode ?\d+|high[- ]?contrast.*|light[- ].+|dark[- ].+)$/i

/** Mode named in a file name like `colors.Dark.json` or `dark.tokens.json`. */
export function modeFromFileName(path: string): string | undefined {
  const parts = basename(path)
    .replace(/\.(tokens\.)?json$/i, '')
    .split('.')
  const last = parts.at(-1)
  if (!last) return undefined
  if (MODE_NAME.test(last)) return last
  // Brand files like "dnb-light" or "acme_dark": the mode is the suffix.
  return last.match(/[-_](light|dark|high[-_]?contrast)$/i)?.[1]
}

const hex2 = (n: number) =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, '0')

/** A Figma RGBA colour (channels 0–1 from the API, 0–255 from some plugins) as CSS hex. */
export function rgbaToHex(c: Obj): string | undefined {
  const [r, g, b] = [c.r, c.g, c.b]
  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') return undefined
  const scale = r > 1 || g > 1 || b > 1 ? 1 : 255
  const a = typeof c.a === 'number' ? c.a : 1
  return `#${hex2(r * scale)}${hex2(g * scale)}${hex2(b * scale)}${a < 1 ? hex2(a * 255) : ''}`
}

const figmaSegments = (name: string) => name.split('/').map((s) => s.trim())
const figmaName = (name: string) => figmaSegments(name).join('.')
const strings = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : undefined
/** `var(--x)` or `--x` from Figma's WEB code syntax. */
const webVariable = (syntax: unknown): string | undefined => {
  const web = isObj(syntax) && typeof syntax.WEB === 'string' ? syntax.WEB.trim() : undefined
  return web?.match(/^(?:var\(\s*)?(--[\w-]+)\s*\)?$/)?.[1]
}
const plainValue = (v: unknown): unknown => (isObj(v) && 'r' in v ? rgbaToHex(v) : v)

/**
 * The Figma REST response of `GET /v1/files/:key/variables/local` (`meta.variables`, `valuesByMode`).
 * Aliases point to variable ids; collections with a single mode are mode-independent.
 */
function fromRest(meta: Obj, path: string): Pick<FigmaExport, 'variables' | 'defaultModes'> {
  const collections = isObj(meta.variableCollections) ? meta.variableCollections : {}
  const variables = isObj(meta.variables) ? meta.variables : {}
  const modeName = new Map<string, string | undefined>()
  // Mode ids in collection order, the collection's default mode first.
  const modeOrder = new Map<string, number>()
  const collectionName = new Map<string, string>()
  const defaultModes: Record<string, string> = {}
  for (const [key, c] of Object.entries(collections)) {
    if (!isObj(c) || !Array.isArray(c.modes)) continue
    collectionName.set(String(c.id ?? key), String(c.name ?? key))
    const single = c.modes.length <= 1
    c.modes.forEach((m, i) => {
      if (!isObj(m)) return
      modeName.set(String(m.modeId), single ? undefined : String(m.name))
      modeOrder.set(String(m.modeId), m.modeId === c.defaultModeId ? -1 : i)
      if (!single && m.modeId === c.defaultModeId) defaultModes[String(c.name ?? key)] = String(m.name)
    })
  }
  const byId = new Map(
    Object.values(variables).flatMap((v) => (isObj(v) ? [[String(v.id), v] as const] : [])),
  )
  const resolve = (value: unknown, modeId: string, depth = 0): unknown => {
    if (isObj(value) && value.type === 'VARIABLE_ALIAS') {
      const target = byId.get(String(value.id))
      if (!target || depth > 10 || !isObj(target.valuesByMode)) return undefined
      const modes = target.valuesByMode
      const next = modeId in modes ? modes[modeId] : Object.values(modes)[0]
      return resolve(next, modeId, depth + 1)
    }
    return plainValue(value)
  }
  const out: FigmaVariable[] = []
  for (const v of Object.values(variables)) {
    if (!isObj(v) || typeof v.name !== 'string' || !isObj(v.valuesByMode)) continue
    if (v.remote === true || v.deletedButReferenced === true) continue
    const modes = Object.entries(v.valuesByMode).sort(
      ([a], [b]) => (modeOrder.get(a) ?? 0) - (modeOrder.get(b) ?? 0),
    )
    for (const [modeId, value] of modes) {
      const target =
        isObj(value) && value.type === 'VARIABLE_ALIAS' ? byId.get(String(value.id))?.name : undefined
      out.push({
        name: figmaName(v.name),
        segments: figmaSegments(v.name),
        type: String(v.resolvedType ?? '').toLowerCase(),
        value: resolve(value, modeId),
        mode: modeName.get(modeId),
        collection: collectionName.get(String(v.variableCollectionId)),
        scopes: strings(v.scopes),
        alias: typeof target === 'string' ? figmaName(target) : undefined,
        cssVariable: webVariable(v.codeSyntax),
        file: path,
      })
    }
  }
  return { variables: out, defaultModes }
}

/**
 * A collection dumped with the Figma Plugin API (`{ id, name, modes: { id: name }, variables: [...] }`), as
 * import scripts write it; one collection or a list of them. Read like the REST response; aliases into
 * collections that are not in the file fall back to the dump's resolved value.
 */
function fromPluginDump(collections: Obj[], path: string): Pick<FigmaExport, 'variables' | 'defaultModes'> {
  const variableCollections: Obj = {}
  const variables: Obj = {}
  const ids = new Set(collections.flatMap((c) => (c.variables as Obj[]).map((v) => String(v.id))))
  for (const c of collections) {
    const modes = Object.entries(c.modes as Obj).map(([modeId, name]) => ({ modeId, name }))
    variableCollections[String(c.id)] = { ...c, modes, defaultModeId: c.defaultModeId ?? modes[0]?.modeId }
    for (const v of c.variables as Obj[]) {
      if (!isObj(v) || !isObj(v.valuesByMode)) continue
      const resolved = isObj(v.resolvedValuesByMode) ? v.resolvedValuesByMode : {}
      const valuesByMode = Object.fromEntries(
        Object.entries(v.valuesByMode).map(([modeId, value]) => {
          const external = isObj(value) && value.type === 'VARIABLE_ALIAS' && !ids.has(String(value.id))
          const r = resolved[modeId]
          return [modeId, external && isObj(r) ? r.resolvedValue : value]
        }),
      )
      variables[String(v.id)] = {
        ...v,
        valuesByMode,
        resolvedType: v.resolvedType ?? v.type,
        variableCollectionId: v.variableCollectionId ?? c.id,
      }
    }
  }
  return fromRest({ variableCollections, variables }, path)
}

/** The "variables2json" plugin: `collections[].modes[].variables[]` with `isAlias` references by name. */
function fromVariables2Json(collections: unknown[], path: string): FigmaVariable[] {
  const out: FigmaVariable[] = []
  for (const c of collections) {
    if (!isObj(c) || !Array.isArray(c.modes)) continue
    const single = c.modes.length <= 1
    for (const m of c.modes) {
      if (!isObj(m) || !Array.isArray(m.variables)) continue
      for (const v of m.variables) {
        if (!isObj(v) || typeof v.name !== 'string') continue
        const target =
          isObj(v.value) && typeof v.value.name === 'string' ? figmaName(v.value.name) : undefined
        out.push({
          name: figmaName(v.name),
          segments: figmaSegments(v.name),
          type: typeof v.type === 'string' ? v.type : undefined,
          // Alias values name their target, e.g. { collection: "primitives", name: "blue/500" }.
          value: v.isAlias ? (target ? ref(target) : undefined) : plainValue(v.value),
          mode: single ? undefined : String(m.name),
          collection: typeof c.name === 'string' ? c.name : undefined,
          scopes: strings(v.scopes),
          alias: v.isAlias ? target : undefined,
          cssVariable: webVariable(v.codeSyntax),
          file: path,
        })
      }
    }
  }
  return out
}

/** An alias that still has to be resolved: `{ $ref: "color.brand" }`. */
type Ref = { $ref: string }
const isRef = (v: unknown): v is Ref => isObj(v) && typeof v.$ref === 'string'
const ref = (name: string): Ref => ({ $ref: name })

/**
 * Resolve aliases across all given variables: chains are followed, the same mode is preferred, then a
 * mode-independent value, then any. What cannot be resolved (remote libraries, cycles) becomes undefined,
 * or stays a reference with `keepUnresolved` (for a single file whose targets may live in another export).
 */
export function resolveAliases(variables: FigmaVariable[], keepUnresolved = false): FigmaVariable[] {
  const byName = new Map<string, FigmaVariable[]>()
  for (const v of variables) {
    const list = byName.get(v.name) ?? []
    list.push(v)
    byName.set(v.name, list)
  }
  const lookup = (name: string, mode: string | undefined) => {
    const list = byName.get(name)
    return list?.find((v) => v.mode === mode) ?? list?.find((v) => !v.mode) ?? list?.[0]
  }
  const resolve = (value: unknown, mode: string | undefined, depth: number): unknown => {
    if (!isRef(value)) return value
    if (depth > 20) return undefined
    const target = lookup(value.$ref, mode)
    if (target) return resolve(target.value, mode, depth + 1)
    // Within one file, a reference may point into another export; resolve it once all are read.
    return keepUnresolved ? value : undefined
  }
  return variables.map((v) => (isRef(v.value) ? { ...v, value: resolve(v.value, v.mode, 0) } : v))
}

/** What Figma's own DTCG export keeps under `$extensions` (flat `com.figma.*` keys or a `com.figma` object). */
function figmaExtensions(node: Obj): Pick<FigmaVariable, 'scopes' | 'alias' | 'cssVariable'> {
  const ext = isObj(node.$extensions) ? node.$extensions : {}
  const nested = isObj(ext['com.figma']) ? ext['com.figma'] : {}
  const get = (key: string) => ext[`com.figma.${key}`] ?? nested[key]
  const alias = get('aliasData')
  return {
    scopes: strings(get('scopes')),
    alias:
      isObj(alias) && typeof alias.targetVariableName === 'string'
        ? figmaName(alias.targetVariableName)
        : undefined,
    cssVariable: webVariable(get('codeSyntax')),
  }
}

/** Read one export. Never throws: what cannot be read is listed in `errors`. */
export function parseFigmaExport(text: string, path: string): FigmaExport {
  const errors: ParseError[] = []
  const doc = parse(text, errors, { allowTrailingComma: true }) as unknown
  const out: FigmaExport = { path, format: 'unknown', variables: [], errors: [] }
  if (errors.length > 0 || (!isObj(doc) && !Array.isArray(doc))) {
    out.errors.push(`${path}: ${NOT_READABLE}`)
    return out
  }
  const dumps = (Array.isArray(doc) ? doc : [doc]).filter(
    (c): c is Obj => isObj(c) && isObj(c.modes) && Array.isArray(c.variables),
  )
  if (dumps.length > 0) {
    out.format = 'figma-plugin'
    Object.assign(out, fromPluginDump(dumps, path))
    return out
  }
  if (!isObj(doc)) {
    out.errors.push(`${path}: ${UNKNOWN_FORMAT}`)
    return out
  }

  if (isObj(doc.meta) && isObj(doc.meta.variables)) {
    out.format = 'figma-rest'
    Object.assign(out, fromRest(doc.meta, path))
    return out
  }
  if (Array.isArray(doc.collections)) {
    out.format = 'variables2json'
    out.variables = resolveAliases(fromVariables2Json(doc.collections, path), true)
    return out
  }

  const fileMode = modeFromFileName(path)
  const fileCollection = fileMode ? collectionFromFileName(path) : undefined
  const raw: (Omit<FigmaVariable, 'file' | 'name'> & { segments: string[] })[] = []
  const walk = (node: Obj, segs: string[], inherited: string | undefined, mode: string | undefined) => {
    const groupType = typeof node.$type === 'string' ? node.$type : inherited
    if ('$value' in node) {
      out.format = 'dtcg'
      raw.push({
        segments: segs,
        type: groupType,
        value: node.$value,
        mode,
        collection: mode && mode === fileMode ? fileCollection : undefined,
        ...figmaExtensions(node),
      })
      return
    }
    if ('value' in node && typeof node.type === 'string' && !isObj(node.value)) {
      if (out.format === 'unknown') out.format = 'tokens-studio'
      raw.push({
        segments: segs,
        type: node.type,
        value: node.value,
        mode,
        collection: mode && mode === fileMode ? fileCollection : undefined,
      })
      return
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith('$') || !isObj(child)) continue
      // A top-level group named like a mode ("Light", "Dark") holds that mode's values, not a path segment.
      if (segs.length === 0 && !mode && MODE_NAME.test(key)) walk(child, [], groupType, key)
      else walk(child, [...segs, key], groupType, mode)
    }
  }
  walk(doc, [], undefined, fileMode)

  for (const r of raw) {
    const target = typeof r.value === 'string' ? r.value.match(REF)?.[1] : undefined
    out.variables.push({
      ...r,
      name: r.segments.join('.'),
      value: target ? ref(target) : r.value,
      alias: target ?? r.alias,
      file: path,
    })
  }
  out.variables = resolveAliases(out.variables, true)
  if (out.format === 'unknown') out.errors.push(`${path}: ${UNKNOWN_FORMAT}`)
  return out
}

const fileParts = (path: string) =>
  basename(path)
    .replace(/\.(tokens\.)?json$/i, '')
    .split('.')
/** `colors.Dark.json` → `colors`: the collection a per-mode file belongs to. */
const collectionFromFileName = (path: string) => fileParts(path).slice(0, -1).join('.') || undefined

/**
 * Figma's variables action and many sync scripts write one file per collection and mode
 * (`Border radius.Pill.json`, `Border radius.Rounded.json`). Mode names there are free text, so
 * files that differ only in their last name part are read as modes of one collection.
 */
export function groupModeFiles(exports: FigmaExport[]): FigmaExport[] {
  const groups = new Map<string, FigmaExport[]>()
  for (const e of exports) {
    const parts = fileParts(e.path)
    if (e.format === 'fig' || parts.length < 2 || e.variables.length === 0 || e.variables.some((v) => v.mode))
      continue
    const key = join(dirname(e.path), parts.slice(0, -1).join('.'))
    groups.set(key, [...(groups.get(key) ?? []), e])
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    for (const e of group) {
      const mode = fileParts(e.path).at(-1)
      const collection = collectionFromFileName(e.path)
      e.variables = e.variables.map((v) => ({ ...v, mode, collection }))
    }
  }
  return exports
}

const guid = (v: unknown) => (isObj(v) && isObj(v.guid) ? `${v.guid.sessionID}:${v.guid.localID}` : '')

/**
 * Variables straight from a `.fig` file, without an export step: collections (variable sets) with
 * their modes in Figma's order, scopes, code syntax and aliases. Variables copied in from a library
 * only serve as alias targets; soft-deleted ones are left out.
 */
export function parseFigFile(bytes: Uint8Array, path: string): FigmaExport {
  const out: FigmaExport = { path, format: 'fig', variables: [], defaultModes: {}, errors: [] }
  let doc: Obj
  try {
    doc = readFigDocument(bytes)
  } catch (error) {
    const reason = error instanceof FigFileError ? error.message : 'damaged or not a Figma file'
    out.errors.push(`${path}: ${reason}`)
    return out
  }
  const nodes = Array.isArray(doc.nodeChanges) ? doc.nodeChanges.filter(isObj) : []
  const sets = new Map<
    string,
    { name: string; modes: { id: string; name: string }[]; publishable: boolean }
  >()
  for (const n of nodes) {
    if (n.type !== 'VARIABLE_SET') continue
    const modes = (Array.isArray(n.variableSetModes) ? n.variableSetModes.filter(isObj) : [])
      .map((m) => ({
        id: `${(m.id as Obj)?.sessionID}:${(m.id as Obj)?.localID}`,
        name: String(m.name),
        at: String(m.sortPosition ?? ''),
      }))
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    sets.set(guid(n), { name: String(n.name ?? ''), modes, publishable: n.isPublishable !== false })
  }
  const variables = new Map<string, Obj>()
  for (const n of nodes) if (n.type === 'VARIABLE' && n.isSoftDeleted !== true) variables.set(guid(n), n)
  const setOf = (v: Obj) => sets.get(guid(v.variableSetID))
  const entry = (v: Obj, mode: string): Obj | undefined => {
    const entries =
      isObj(v.variableDataValues) && Array.isArray(v.variableDataValues.entries)
        ? v.variableDataValues.entries.filter(isObj)
        : []
    const id = (e: Obj) => `${(e.modeID as Obj)?.sessionID}:${(e.modeID as Obj)?.localID}`
    const own = setOf(v)?.modes[0]?.id
    const found = entries.find((e) => id(e) === mode) ?? entries.find((e) => id(e) === own) ?? entries[0]
    return isObj(found?.variableData) ? found.variableData : undefined
  }
  const aliasOf = (data: Obj | undefined) =>
    isObj(data?.value) && isObj(data.value.alias) ? variables.get(guid(data.value.alias)) : undefined
  const resolvedValue = (data: Obj | undefined, mode: string, depth = 0): unknown => {
    const value = isObj(data?.value) ? data.value : {}
    if (isObj(value.alias)) {
      const target = aliasOf(data)
      return target && depth < 20 ? resolvedValue(entry(target, mode), mode, depth + 1) : undefined
    }
    if (isObj(value.colorValue)) return rgbaToHex(value.colorValue)
    return value.floatValue ?? value.textValue ?? value.boolValue
  }
  const local = [...variables.values()]
    .filter((v) => setOf(v))
    // Published collections first: their variables win a name shared with a hidden copy.
    .sort((a, b) => Number(setOf(b)?.publishable) - Number(setOf(a)?.publishable))
  for (const v of local) {
    const set = setOf(v) as NonNullable<ReturnType<typeof setOf>>
    const syntax = isObj(v.codeSyntax) && Array.isArray(v.codeSyntax.entries) ? v.codeSyntax.entries : []
    const web = syntax.find((e) => isObj(e) && e.platform === 'WEB') as Obj | undefined
    if (set.modes.length > 1 && set.modes[0] && out.defaultModes && !(set.name in out.defaultModes))
      out.defaultModes[set.name] = set.modes[0].name
    for (const mode of set.modes.length > 0 ? set.modes : [{ id: '', name: '' }]) {
      const data = entry(v, mode.id)
      const target = aliasOf(data)
      out.variables.push({
        name: figmaName(String(v.name ?? '')),
        segments: figmaSegments(String(v.name ?? '')),
        type: String(v.variableResolvedType ?? '').toLowerCase(),
        value: resolvedValue(data, mode.id),
        mode: set.modes.length > 1 ? mode.name : undefined,
        collection: set.name,
        scopes: strings(v.variableScopes),
        alias: target && setOf(target) ? figmaName(String(target.name ?? '')) : undefined,
        cssVariable: webVariable({ WEB: web?.value }),
        file: path,
      })
    }
  }
  if (sets.size === 0) out.errors.push(`${path}: no variables in this Figma file`)
  return out
}

/** All exports matching `include` (relative to `root`), plus explicit files and folders. */
export async function readFigmaExports(
  root: string,
  include: readonly string[],
  files: readonly string[] = [],
): Promise<FigmaExport[]> {
  const ignore = ['**/node_modules/**', '**/.git/**']
  const found = include.length > 0 ? await glob([...include], { cwd: root, ignore }) : []
  const explicit: string[] = []
  // Files found in a folder or by a pattern may be any JSON (package.json, configs): only exports and
  // broken files count.
  const searched = new Set(found)
  for (const file of files) {
    const isDir = await stat(join(root, file)).then(
      (s) => s.isDirectory(),
      () => false,
    )
    if (!isDir) explicit.push(file)
    else
      for (const inner of await glob(['**/*.json', '**/*.fig'], { cwd: join(root, file), ignore }))
        searched.add(join(file, inner))
  }
  const paths = [...new Set([...searched, ...explicit])].sort()
  const exports: FigmaExport[] = []
  for (const path of paths) {
    const e = path.endsWith('.fig')
      ? parseFigFile(await readFile(join(root, path)), path)
      : parseFigmaExport(await readFile(join(root, path), 'utf8'), path)
    if (e.format !== 'unknown' || explicit.includes(path) || e.errors.some((m) => m.endsWith(NOT_READABLE)))
      exports.push(e)
  }
  return groupModeFiles(exports)
}

/** Names a token may have in Figma: `ids.figma`, its register path, or its CSS variable without `--`. */
export const figmaVariableNames = (token: Token): string[] => [
  ...(token.accord?.ids?.figma ? [token.accord.ids.figma] : []),
  token.path.replace(/\.\$root$/, ''),
  token.path,
  cssVariableName(token),
  cssVariableName(token).replace(/^--/, ''),
]

const DEFAULT_MODES = ['light', 'default', 'mode 1', 'mode1', 'hell', 'base']

/**
 * The values Figma shows by default: per collection the configured mode, else the default the export
 * declares, else a usual default name (Light, Default), else its first mode.
 */
export interface FigmaDefaultView {
  /** Variables in their collection's default mode (or without modes); the first export wins for a name. */
  defaults: FigmaVariable[]
  /** Values in other modes. */
  others: FigmaVariable[]
  modes: string[]
  /** Default mode per collection (`''` for variables without a collection). */
  defaultModes: Map<string, string>
}

export function figmaDefaultView(
  exports: readonly FigmaExport[],
  options: { defaultMode?: string | undefined } = {},
): FigmaDefaultView {
  const all = resolveAliases(exports.flatMap((e) => e.variables))
  const byCollection = new Map<string, string[]>()
  for (const v of all) {
    if (!v.mode) continue
    const list = byCollection.get(v.collection ?? '') ?? []
    if (!list.includes(v.mode)) list.push(v.mode)
    byCollection.set(v.collection ?? '', list)
  }
  const configured = options.defaultMode?.toLowerCase()
  const declared = Object.assign({}, ...exports.map((e) => e.defaultModes ?? {})) as Record<string, string>
  const defaultModes = new Map<string, string>()
  for (const [collection, modes] of byCollection) {
    const main =
      modes.find((m) => m.toLowerCase() === configured) ??
      modes.find((m) => m === declared[collection]) ??
      modes.find((m) => DEFAULT_MODES.includes(m.toLowerCase())) ??
      (modes[0] as string)
    defaultModes.set(collection, main)
  }
  const isDefault = (v: FigmaVariable) => !v.mode || defaultModes.get(v.collection ?? '') === v.mode
  const seen = new Set<string>()
  const defaults: FigmaVariable[] = []
  // Moded defaults before mode-independent values, as before: a light value beats an unmoded duplicate.
  for (const v of [...all.filter((x) => x.mode && isDefault(x)), ...all.filter((x) => !x.mode)])
    if (!seen.has(v.name)) {
      seen.add(v.name)
      defaults.push(v)
    }
  return {
    defaults,
    others: all.filter((v) => !isDefault(v)),
    modes: [...new Set([...byCollection.values()].flat())],
    defaultModes,
  }
}

export interface FigmaStatus extends VariableSurfaceStatus {
  modes: string[]
  /** The modes compared, one per collection with modes. */
  defaultMode?: string | undefined
  errors: string[]
}

/** Compare Figma exports with the register: the default mode is compared, other modes are kept as theme values. */
export function figmaStatus(
  exports: readonly FigmaExport[],
  register: Register,
  lock: Lock,
  options: { defaultMode?: string | undefined } = {},
): FigmaStatus {
  const view = figmaDefaultView(exports, options)
  const variables = new Map<string, SurfaceVariable>()
  for (const v of view.defaults)
    variables.set(v.name, { name: v.name, value: v.value, themed: [], file: v.file })
  for (const v of view.others) {
    const base = variables.get(v.name)
    if (!base) {
      variables.set(v.name, {
        name: v.name,
        value: undefined,
        themed: [{ theme: { mode: v.mode as string }, value: v.value }],
        file: v.file,
      })
      continue
    }
    if (JSON.stringify(base.value) !== JSON.stringify(v.value))
      base.themed.push({ theme: { mode: v.mode as string }, value: v.value })
  }
  const main = [...new Set(view.defaultModes.values())]
  const status = variableSurfaceStatus({
    surface: 'figma',
    variables: [...variables.values()],
    register,
    lock,
    names: figmaVariableNames,
    // The other modes of the collections (Dark); those the register has as contexts are compared there.
    modes: view.modes.filter((m) => !main.includes(m)),
  })
  return {
    ...status,
    modes: view.modes,
    defaultMode: main.length > 0 ? main.join(', ') : undefined,
    errors: exports.flatMap((e) => e.errors),
  }
}
