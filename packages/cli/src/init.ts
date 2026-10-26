import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  codeSnapshot,
  componentForVariants,
  cssToTokenValue,
  cssVariableName,
  type DesignImport,
  type DesignVariable,
  isDefaultThemeScope,
  linkedVariables,
  type ResolvedVariable,
  readComponentModule,
  readStylesheets,
  resolveCssVariables,
  tokensFromDesign,
} from '@decivo/accord-adapter-code'
import { figmaDefaultView, readFigmaExports } from '@decivo/accord-adapter-figma'
import { parsePen } from '@decivo/accord-adapter-pen'
import {
  ACCORD_EXTENSION_KEY,
  buildRegister,
  CONFIG_FILE,
  contextFile,
  cssToColor,
  formatValue,
  hasErrors,
  type Issue,
  importTokensStudio,
  isTokenFile,
  parseTokens,
  RESOLVER_FILE,
  type Register,
  type Token,
  type TokenFile,
  upgradeLegacyDtcg,
  valuesEqual,
} from '@decivo/accord-core'
import { escapePath, glob } from 'tinyglobby'
import { stringify } from 'yaml'
import { type DetectedSources, detectSources } from './detect.js'
import { AccordError } from './errors.js'
import {
  type ContextValues,
  contextFromTokenFile,
  contextsFromCode,
  contextsFromDesign,
  type DesignModeValue,
  defaultContextName,
  type InitModes,
  modeFiles,
  themeContextName,
} from './init-modes.js'
import type { T } from './messages.js'
import { applyPreset } from './presets/shadcn.js'

/**
 * Where the first register comes from. After init the register is the only truth; this only decides
 * who wins where today's sources disagree.
 * - `code`: what runs in production wins (existing products). Token-file values that differ are corrected
 *   from the CSS variables; tokens without a CSS variable are left out and listed.
 * - `tokens`: the token file wins (e.g. a maintained Tokens Studio / DTCG export). Differences in code stay drift.
 * - `design`: the design tool is the truth (Figma-first teams, new products): Figma variable exports
 *   (`--figma`, or the files under `figma/`) or the repository's Pencil files.
 */
export type InitSource = 'code' | 'tokens' | 'design'

export interface InitOpenPoints {
  /** Token values replaced by the value found in code (`--from code`). */
  corrected: { path: string; tokens: string; code: string }[]
  /** Tokens from the token file without a CSS variable, not taken over (`--from code`). */
  dropped: string[]
  /** Colour variables in code without a token: candidates for later proposals. */
  codeOnly: number
  /**
   * Token files not taken over: alternates of a set already imported (another mode or brand with the
   * same tokens), files that are not readable, or files that would leave the register invalid.
   */
  skipped: {
    file: string
    reason: 'alternate' | 'unreadable' | 'invalid' | 'invalidTokens'
    detail: string
  }[]
  /** `--from design`: where the tokens came from and what was not taken over. */
  design?: DesignOrigin | undefined
}

export interface DesignOrigin {
  surface: 'figma' | 'pen'
  sources: string[]
  /** Variables in the default mode, before validation. */
  variables: number
  /**
   * Per collection (Figma) or theme axis (Pencil): the mode taken over and the other ones. `contexts` is set
   * where the other modes became contexts of the register (light/dark); the rest follow with more modifiers.
   */
  modes: { collection: string; main: string; others: string[]; contexts?: string[] | undefined }[]
  skipped: DesignImport['skipped']
  errors: string[]
}

export interface InitPlan {
  detected: DetectedSources
  source: {
    kind: InitSource
    reason: 'flag' | 'code-has-variables' | 'no-code-variables' | 'design-only'
  }
  openPoints: InitOpenPoints
  /** Register files keyed by path relative to the register directory. */
  files: Map<string, string>
  register: Register
  /** Tokens that got an explicit `ids.css`. */
  mappedVariables: { token: string; variable: string }[]
  /** Contexts (light/dark) taken over into `modes/` and `resolver.json`; undefined when there were none. */
  modes?: InitModes | undefined
  components: string[]
  importIssues: Issue[]
}

type Obj = Record<string, unknown>

/** Variables that apply by default: `:root`, `@theme`, or a light theme such as `[data-theme=light]`. */
const isBase = (scope: string) => scope === 'base' || isDefaultThemeScope(scope)

const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w && !['color', 'root', 'default'].includes(w)),
  )
const overlap = (a: string, b: string) => {
  const wb = words(b)
  return [...words(a)].filter((w) => wb.has(w)).length
}

/**
 * Give each token the CSS variable that already carries its value in code, when the variable
 * does not follow the naming convention. A match needs the same value and a shared word in the
 * name, or must be the only variable with that value. Variables defined from other variables
 * (`--color-brand: var(--brand-blue)`) lose against their source.
 */
export function assignCssVariables(tokens: Token[], variables: ReadonlyMap<string, ResolvedVariable>) {
  const taken = new Set(tokens.map((t) => cssVariableName(t)).filter((name) => variables.has(name)))
  const assignments: { token: Token; variable: string }[] = []
  const pool = [...variables.values()].filter((v) => isBase(v.scope) && v.resolved !== undefined)

  for (const token of tokens) {
    if (variables.has(cssVariableName(token)) || token.value === undefined || token.inheritedFrom) continue
    const sameValue = pool.filter((v) => {
      if (taken.has(v.name)) return false
      const value = cssToTokenValue(token.type, v.resolved as string)
      return value !== undefined && valuesEqual(token.type, value, token.value)
    })
    if (sameValue.length === 0) continue
    const scored = sameValue
      .map((v) => ({ v, score: overlap(token.path, v.name), source: v.references.length === 0 }))
      .sort(
        (a, b) =>
          b.score - a.score || Number(b.source) - Number(a.source) || a.v.name.length - b.v.name.length,
      )
    const best = scored[0]
    if (!best || (best.score === 0 && sameValue.length > 1)) continue
    taken.add(best.v.name)
    assignments.push({ token, variable: best.v.name })
  }
  return assignments
}

function setTokenExtension(content: Obj, path: string, variable: string): void {
  let node: Obj = content
  for (const seg of path.split('.')) node = node[seg] as Obj
  const extensions = (node.$extensions ?? {}) as Obj
  const accord = (extensions[ACCORD_EXTENSION_KEY] ?? {}) as Obj
  accord.ids = { ...((accord.ids as Obj) ?? {}), css: variable }
  extensions[ACCORD_EXTENSION_KEY] = accord
  node.$extensions = extensions
}

const pascal = (file: string) =>
  basename(file)
    .replace(/\.[^.]+$/, '')
    .split(/[-_]/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('')
const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

async function componentContracts(root: string, uiDir: string) {
  const files = await glob([`${uiDir}/*.{tsx,jsx}`], { cwd: root, ignore: ['**/*.stories.*', '**/*.test.*'] })
  const contracts: Obj[] = []
  for (const file of files.sort()) {
    const module = readComponentModule(await readFile(join(root, file), 'utf8'), file)
    const name = module.exports.includes(pascal(file)) ? pascal(file) : module.exports[0]
    if (!name) continue
    const variantsVar = Object.keys(module.variants).find((v) => componentForVariants(v) === name)
    const anatomy = module.exports
      .filter((e) => e !== name && e.startsWith(name))
      .map((e) => kebab(e.slice(name.length)))
    const contract: Obj = { name, status: 'draft' }
    if (anatomy.length > 0) contract.anatomy = ['root', ...anatomy]
    if (variantsVar) contract.variants = module.variants[variantsVar]
    contract.mappings = { code: { path: file, export: name } }
    // Key order as in the contract schema, so generated YAML reads naturally.
    const filled = applyPreset(contract)
    const ordered: Obj = {}
    for (const key of [
      'name',
      'status',
      'description',
      'anatomy',
      'variants',
      'props',
      'states',
      'slots',
      'a11y',
      'mappings',
    ]) {
      if (filled[key] !== undefined) ordered[key] = filled[key]
    }
    contracts.push(ordered)
  }
  return contracts
}

function configYaml(
  detected: DetectedSources,
  tokenGroups: string[],
  hasComponents: boolean,
  include: string[],
  figmaInclude?: string[],
  codeModes?: Record<string, string>,
): string {
  const rules: string[] = []
  for (const group of tokenGroups) rules.push(`    - { match: tokens.${group}.**, owner: design }`)
  if (hasComponents) {
    rules.push(
      '    - { match: components.*.variants.**, owner: design }',
      '    - { match: components.*.props.**, owner: code }',
      '    - { match: components.*.states.**, owner: code }',
      '    - { match: components.*.slots.**, owner: code }',
    )
  }
  return `# decivo Accord – register configuration. Reference: https://www.npmjs.com/package/@decivo/accord-cli
version: 1

surfaces:
  code:
    enabled: true
    include: ${JSON.stringify(include)}
    css: ${JSON.stringify(detected.css)}${codeModes ? `\n    # Selector of each context in code (light is :root).\n    modes: ${JSON.stringify(codeModes)}` : ''}
  claude_design:
    enabled: false
  figma:
    enabled: ${figmaInclude !== undefined}${figmaInclude ? `\n    include: ${JSON.stringify(figmaInclude)}` : ''}
  pen:
    enabled: ${detected.pen.length > 0}

# Who owns what. Names, additions, deletions and deprecations always belong to the register.
ownership:
  default: register
  rules:
${rules.length > 0 ? rules.join('\n') : '    []'}

routing:
  # Minimum confidence for automatic acceptance. Breaking changes, deletions and \`must\` violations always go to a human.
  auto_apply: { low: 0.85, medium: 0.95 }

matching:
  color_near_delta_e: 5
`
}

function decisions(t: T, include: string[], colorGroups: string[]): Map<string, string> {
  const out = new Map<string, string>()
  out.set(
    'decisions/D-001.yaml',
    stringify({
      id: 'D-001',
      rule: t('decision.noRawColors.rule'),
      why: t('decision.noRawColors.why'),
      scope: include.map((g) => `code:${g}`),
      level: 'must',
      owner: 'register',
      fix_hint: t('decision.noRawColors.fix'),
      checks: [{ type: 'deterministic', rule: { kind: 'no_raw_values', types: ['color'] } }],
    }),
  )
  // The colour scale is wherever the colour tokens live; without colour tokens there is no scale to keep.
  if (colorGroups.length === 0) return out
  const scale = colorGroups.length === 1 ? `tokens.${colorGroups[0]}.**` : 'tokens.**'
  out.set(
    'decisions/D-002.yaml',
    stringify({
      id: 'D-002',
      rule: t('decision.colorsFromRegister.rule'),
      why: t('decision.colorsFromRegister.why'),
      scope: [scale],
      level: 'must',
      owner: 'design',
      fix_hint: t('decision.colorsFromRegister.fix'),
      checks: [{ type: 'deterministic', rule: { kind: 'value_in_scale', scale } }],
    }),
  )
  return out
}

function tokenNode(content: Obj, path: string): Obj | undefined {
  let node: unknown = content
  for (const seg of path.split('.')) node = (node as Obj | undefined)?.[seg]
  return node as Obj | undefined
}

function deleteToken(content: Obj, path: string): void {
  const segs = path.split('.')
  const parents: Obj[] = [content]
  for (const seg of segs.slice(0, -1)) parents.push(parents.at(-1)?.[seg] as Obj)
  delete parents.at(-1)?.[segs.at(-1) as string]
  // Remove groups left without tokens.
  for (let i = parents.length - 1; i > 0; i--) {
    const group = parents[i] as Obj
    if (Object.keys(group).some((k) => !k.startsWith('$') || k === '$root')) break
    delete (parents[i - 1] as Obj)[segs[i - 1] as string]
  }
}

/** Without any token file: one token per source colour/length variable, named after the variable. */
function tokensFromCode(variables: ReadonlyMap<string, ResolvedVariable>): TokenFile[] {
  const color: Obj = { $type: 'color' }
  const dimension: Obj = { $type: 'dimension' }
  for (const v of variables.values()) {
    if (!isBase(v.scope) || v.references.length > 0 || v.resolved === undefined) continue
    const name = v.name.replace(/^--/, '').replace(/^color-/, '')
    const extensions = { [ACCORD_EXTENSION_KEY]: { ids: { css: v.name } } }
    const asColor = /^(#|rgb|hsl|oklch|oklab|lab|lch|hwb)/i.test(v.resolved)
      ? cssToColor(v.resolved)
      : undefined
    if (asColor) color[name] = { $value: asColor, $extensions: extensions }
    else {
      const asLength = cssToTokenValue('dimension', v.resolved)
      if (asLength) dimension[name] = { $value: asLength, $extensions: extensions }
    }
  }
  const files: TokenFile[] = []
  if (Object.keys(color).length > 1) files.push({ file: 'tokens/color.tokens.json', content: { color } })
  if (Object.keys(dimension).length > 1)
    files.push({ file: 'tokens/dimension.tokens.json', content: { dimension } })
  return files
}

export interface InitOptions {
  /** Explicit start source; without it, code wins when it defines CSS variables, else the token file. */
  from?: InitSource | undefined
  /** `--from design`: Figma export files or folders (relative to the root). */
  figma?: string[] | undefined
  /** Figma mode to take over where a collection has it (default: Light/Default/first). */
  mode?: string | undefined
}

const FIGMA_INCLUDE = ['figma/**/*.json', '**/*.figma.json', '**/*.fig']

/**
 * Which modes of a collection (or theme axis) are theme contexts: the other modes that are named like one
 * (Dark, High contrast), each with its context name. Empty for collections like Rounded/Pill or brands.
 */
function themeModes(main: string, others: readonly string[]): Map<string, string> {
  const fallback = defaultContextName(main)
  const out = new Map<string, string>()
  for (const mode of others) {
    const context = themeContextName(mode)
    if (context && context !== fallback) out.set(mode, context)
  }
  return out
}

interface DesignSource {
  origin: DesignOrigin
  variables: DesignVariable[]
  figmaInclude?: string[]
  /** Values in theme modes other than the default (Figma Dark, Pencil mode: dark). */
  modeValues: DesignModeValue[]
  /** Context of the default mode, e.g. `light`. */
  defaultContext: string
}

/** The variables of the design tool: Figma exports if given or found, else the repository's Pencil files. */
async function designVariables(
  root: string,
  detected: DetectedSources,
  options: InitOptions,
): Promise<DesignSource> {
  const exports = await readFigmaExports(root, options.figma?.length ? [] : FIGMA_INCLUDE, options.figma)
  if (exports.length > 0) {
    const view = figmaDefaultView(exports, { defaultMode: options.mode })
    const modes = new Map<string, Set<string>>()
    for (const v of view.others) {
      const key = v.collection ?? ''
      modes.set(key, (modes.get(key) ?? new Set()).add(v.mode as string))
    }
    const themes = new Map(
      [...view.defaultModes].map(([collection, main]) => [
        collection,
        themeModes(main, [...(modes.get(collection) ?? [])]),
      ]),
    )
    const modeValues: DesignModeValue[] = view.others.flatMap((v) => {
      const context = themes.get(v.collection ?? '')?.get(v.mode as string)
      return context ? [{ name: v.name, context, value: v.value, alias: v.alias }] : []
    })
    const themed = [...view.defaultModes].find(([collection]) => (themes.get(collection)?.size ?? 0) > 0)
    const include = options.figma?.length
      ? await Promise.all(
          options.figma.map(async (f) =>
            (await stat(join(root, f))).isDirectory()
              ? `${escapePath(f.replace(/\/+$/, ''))}/**/*.json`
              : escapePath(f),
          ),
        )
      : FIGMA_INCLUDE
    return {
      variables: view.defaults,
      figmaInclude: include,
      origin: {
        surface: 'figma',
        sources: exports.map((e) => e.path),
        variables: view.defaults.length,
        modes: [...view.defaultModes].map(([collection, main]) => {
          const contexts = themes.get(collection)
          return {
            collection,
            main,
            others: [...(modes.get(collection) ?? [])],
            ...(contexts && contexts.size > 0 ? { contexts: [...new Set(contexts.values())] } : {}),
          }
        }),
        skipped: [],
        errors: exports.flatMap((e) => e.errors),
      },
      modeValues,
      defaultContext: themed ? defaultContextName(themed[1]) : 'light',
    }
  }
  if (detected.pen.length > 0) {
    const docs = []
    for (const path of detected.pen) docs.push(parsePen(await readFile(join(root, path), 'utf8'), path))
    // Several .pen files often share a library; the first file wins for a name.
    const seen = new Set<string>()
    const variables: DesignVariable[] = []
    for (const v of docs.flatMap((d) => d.variables)) {
      if (seen.has(v.name)) continue
      seen.add(v.name)
      variables.push({
        name: v.name,
        type: v.type,
        value: v.value,
        cssVariable: /^--[\w-]+$/.test(v.name) ? v.name : undefined,
      })
    }
    const axes = new Map<string, string[]>()
    for (const d of docs)
      for (const [axis, values] of Object.entries(d.themes)) if (!axes.has(axis)) axes.set(axis, values)
    const themes = new Map(
      [...axes].map(([axis, values]) => [axis, themeModes(values[0] as string, values.slice(1))]),
    )
    const named = new Set<string>()
    const modeValues: DesignModeValue[] = []
    for (const v of docs.flatMap((d) => d.variables)) {
      if (named.has(v.name)) continue
      named.add(v.name)
      for (const entry of v.themed) {
        const [axis, value] = Object.entries(entry.theme)[0] ?? []
        const context = axis && value ? themes.get(axis)?.get(value) : undefined
        if (context) modeValues.push({ name: v.name, context, value: entry.value })
      }
    }
    const themed = [...axes].find(([axis]) => (themes.get(axis)?.size ?? 0) > 0)
    return {
      variables,
      origin: {
        surface: 'pen',
        sources: docs.map((d) => d.path),
        variables: variables.length,
        modes: [...axes].map(([collection, values]) => {
          const contexts = themes.get(collection)
          return {
            collection,
            main: values[0] as string,
            others: values.slice(1),
            ...(contexts && contexts.size > 0 ? { contexts: [...new Set(contexts.values())] } : {}),
          }
        }),
        skipped: [],
        errors: docs.flatMap((d) => d.errors),
      },
      modeValues,
      defaultContext: themed ? defaultContextName(themed[1][0] as string) : 'light',
    }
  }
  throw new AccordError('init.designNone', {})
}

export async function planInit(root: string, t: T, options: InitOptions = {}): Promise<InitPlan> {
  const detected = await detectSources(root)
  const importIssues: Issue[] = []

  // Imports are followed: a globals.css that imports its theme defines that theme's variables.
  const { variables } = await readStylesheets(root, detected.css)
  const resolved = resolveCssVariables(variables)

  const from = options.from ?? (options.figma?.length ? 'design' : undefined)
  const designOnly = detected.tokens.length === 0 && (detected.figma.length > 0 || detected.pen.length > 0)
  const source: InitPlan['source'] = from
    ? { kind: from, reason: 'flag' }
    : resolved.size > 0
      ? { kind: 'code', reason: 'code-has-variables' }
      : designOnly
        ? { kind: 'design', reason: 'design-only' }
        : { kind: 'tokens', reason: 'no-code-variables' }

  // Tokens: DTCG files are taken as they are; a Tokens Studio export is converted.
  let tokenFiles: TokenFile[] = []
  const dtcg = detected.tokens.filter((f) => f.format === 'dtcg')
  const studio = detected.tokens.find((f) => f.format === 'tokens-studio')
  const skipped: InitOpenPoints['skipped'] = []
  let design: DesignSource | undefined
  let designPaths = new Map<string, string>()
  /** Alternate token files (another mode or brand), kept to take a dark one over as a context. */
  const alternates: TokenFile[] = []
  if (source.kind === 'design') {
    design = await designVariables(root, detected, options)
    const imported = tokensFromDesign(design.variables, design.origin.surface)
    tokenFiles = imported.files
    designPaths = imported.paths
    design.origin.skipped = imported.skipped
  } else if (dtcg.length > 0) {
    // The default set first (light, default, base), so that alternates (dark, other brands) are what is left out.
    const rank = (p: string) =>
      /(^|[^a-z])(light|default|base|core|global)([^a-z]|$)/i.test(basename(p)) ? 0 : 1
    const ordered = [...dtcg].sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path))
    const owner = new Map<string, string>()
    for (const f of ordered) {
      let content: unknown
      try {
        content = JSON.parse(await readFile(join(root, f.path), 'utf8'))
      } catch (error) {
        skipped.push({ file: f.path, reason: 'unreadable', detail: (error as Error).message })
        continue
      }
      // Most real DTCG files still use the older draft notation ("#fff", "16px"); upgrade them on the way in.
      upgradeLegacyDtcg(content)
      const paths = [...parseTokens([{ file: f.path, content }]).tokens.keys()]
      const overlap = paths.find((p) => owner.has(p))
      if (overlap) {
        skipped.push({ file: f.path, reason: 'alternate', detail: owner.get(overlap) as string })
        alternates.push({ file: f.path, content })
        continue
      }
      for (const p of paths) owner.set(p, f.path)
      // Same file name in different folders (origin/Value.json, baseline/Value.json) must not collide.
      let name = basename(f.path).replace(/\.tokens(\.json)?$|\.json$/, '')
      if (tokenFiles.some((t) => t.file === `tokens/${name}.tokens.json`))
        name = `${basename(dirname(f.path))}-${name}`.replace(/[^\w.-]+/g, '-')
      tokenFiles.push({ file: `tokens/${name}.tokens.json`, content })
    }
  } else if (studio) {
    const imported = importTokensStudio(
      JSON.parse(await readFile(join(root, studio.path), 'utf8')),
      studio.path,
    )
    tokenFiles = imported.files
    importIssues.push(...imported.issues)
  } else if (source.kind === 'code') {
    tokenFiles = tokensFromCode(resolved)
  }

  // Connect tokens to the CSS variables that already exist in code.
  const { tokens } = parseTokens(tokenFiles)
  const assignments = assignCssVariables([...tokens.values()], resolved)
  for (const { token, variable } of assignments) {
    const file = tokenFiles.find((f) => f.file === token.file)
    if (file) setTokenExtension(file.content as Obj, token.path, variable)
  }

  // Code wins: correct differing values, leave out tokens the code does not have.
  const openPoints: InitOpenPoints = {
    corrected: [],
    dropped: [],
    codeOnly: 0,
    skipped,
    design: design?.origin,
  }
  const mapped = parseTokens(tokenFiles).tokens
  const code = codeSnapshot(mapped.values(), resolved)
  if (source.kind === 'code' && tokenFiles.length > 0) {
    for (const token of mapped.values()) {
      const file = tokenFiles.find((f) => f.file === token.file)
      if (!file || token.inheritedFrom) continue
      const inCode = code.snapshot.tokens.get(token.path)
      if (inCode && !valuesEqual(token.type, inCode.value, token.value)) {
        const node = tokenNode(file.content as Obj, token.path)
        if (node) node.$value = inCode.value
        openPoints.corrected.push({
          path: token.path,
          tokens: formatValue(token.type, token.value),
          code: formatValue(token.type, inCode.value),
        })
      }
      if (code.missing.includes(token.path)) {
        deleteToken(file.content as Obj, token.path)
        openPoints.dropped.push(token.path)
      }
    }
    tokenFiles = tokenFiles.filter((f) => Object.keys(f.content as Obj).length > 0)
  }
  const finalTokens = parseTokens(tokenFiles).tokens
  // A variable belongs to a token when it is the token's variable, one it points to, or an alias of it.
  const linked = linkedVariables(resolved, [...finalTokens.values()].map(cssVariableName))
  openPoints.codeOnly = [...resolved.values()].filter(
    (v) =>
      isBase(v.scope) &&
      !linked.has(v.name) &&
      v.resolved !== undefined &&
      /^(#|rgb|hsl|oklch|oklab|lab|lch|hwb)/i.test(v.resolved),
  ).length

  const include = ['src/**/*.{ts,tsx,js,jsx,css}']
  const contracts = detected.uiDir ? await componentContracts(root, detected.uiDir) : []
  const tokenGroups = [...new Set([...finalTokens.keys()].map((p) => p.split('.')[0] as string))]
  const colorGroups = [
    ...new Set(
      [...finalTokens.values()].filter((t) => t.type === 'color').map((t) => t.path.split('.')[0] as string),
    ),
  ]

  const files = new Map<string, string>()
  files.set(
    'accord.config.yaml',
    configYaml(detected, tokenGroups, contracts.length > 0, include, design?.figmaInclude),
  )
  for (const f of tokenFiles) files.set(f.file, `${JSON.stringify(f.content, null, 2)}\n`)
  for (const c of contracts) files.set(`components/${kebab(c.name as string)}.yaml`, stringify(c))
  for (const [path, content] of decisions(t, include, colorGroups)) files.set(path, content)

  // Safety net: tokens that would leave the register invalid are left out and counted, never written.
  // Only a file whose errors cannot be pinned to single tokens is dropped as a whole.
  let register = buildRegister([...files].map(([path, content]) => ({ path, content })))
  const removed = new Map<string, { count: number; first: string }>()
  for (let round = 0; round < 20 && hasErrors(register.issues); round++) {
    const bad = register.issues.filter((i) => i.severity === 'error' && i.file && isTokenFile(i.file))
    if (bad.length === 0) break
    const done = new Set<string>()
    for (const issue of bad) {
      // A token can have several errors; once it is removed, the others are settled too.
      if (done.has(`${issue.file}|${issue.path}`)) continue
      const file = tokenFiles.find((f) => f.file === issue.file)
      const node = file && issue.path ? tokenNode(file.content as Obj, issue.path) : undefined
      if (file && issue.path && node && '$value' in node) {
        deleteToken(file.content as Obj, issue.path)
        done.add(`${issue.file}|${issue.path}`)
        const entry = removed.get(file.file) ?? { count: 0, first: `${issue.path}: ${issue.message}` }
        entry.count++
        removed.set(file.file, entry)
      } else if (issue.file && files.has(issue.file)) {
        files.delete(issue.file)
        tokenFiles = tokenFiles.filter((f) => f.file !== issue.file)
        skipped.push({ file: issue.file, reason: 'invalid', detail: issue.message })
      }
    }
    for (const f of tokenFiles)
      if (Object.keys(f.content as Obj).length > 0)
        files.set(f.file, `${JSON.stringify(f.content, null, 2)}\n`)
      else files.delete(f.file)
    register = buildRegister([...files].map(([path, content]) => ({ path, content })))
  }
  for (const [file, { count, first }] of removed)
    skipped.push({ file, reason: 'invalidTokens', detail: `${count} token(s), e.g. ${first}` })

  // Contexts (light/dark) from the same start source as the values: the dark block in code, Figma's
  // theme modes, Pencil's theme axis, or a dark token file next to the default one.
  let values: ContextValues = new Map()
  let modes: InitModes | undefined
  if (!hasErrors(register.issues)) {
    const tokens = register.tokens
    if (source.kind === 'code') {
      const fromCode = contextsFromCode([...tokens.values()], variables)
      values = fromCode.values
      if (fromCode.selector)
        modes = {
          source: 'code',
          selector: fromCode.selector,
          from: detected.css,
          contexts: ['light', 'dark'],
          default: 'light',
          values: {},
          unreadable: { dark: fromCode.unreadable },
          contextOnly: { dark: fromCode.contextOnly },
        }
    } else if (design && design.modeValues.length > 0) {
      const fromDesign = contextsFromDesign(tokens, designPaths, design.modeValues)
      values = fromDesign.values
      modes = {
        source: design.origin.surface,
        from: design.origin.modes.filter((m) => m.contexts).map((m) => m.collection),
        contexts: [design.defaultContext, ...values.keys()],
        default: design.defaultContext,
        values: {},
        unreadable: fromDesign.unreadable,
      }
    } else if (source.kind === 'tokens' && alternates.length > 0) {
      const from: string[] = []
      for (const alt of alternates) {
        const context = themeContextName(
          basename(alt.file)
            .replace(/\.tokens(\.json)?$|\.json$/, '')
            .split(/[.\s]/)
            .at(-1) ?? '',
        )
        if (!context || context === 'light' || values.has(context)) continue
        values.set(context, contextFromTokenFile(tokens, alt))
        from.push(alt.file)
      }
      if (from.length > 0) {
        modes = {
          source: 'tokens',
          from,
          contexts: ['light', ...values.keys()],
          default: 'light',
          values: {},
          unreadable: {},
        }
        // Taken over as a context, no longer an open point.
        for (let i = skipped.length - 1; i >= 0; i--)
          if (from.includes(skipped[i]?.file as string)) skipped.splice(i, 1)
      }
    }
  }
  // Values a context cannot hold (an alias that leaves the register invalid) are left out, like tokens above.
  for (let round = 0; modes && round < 10; round++) {
    for (const path of [...files.keys()])
      if (path.startsWith('modes/') || path === RESOLVER_FILE) files.delete(path)
    const generated = modeFiles({
      tokenFiles: [...files.keys()].filter(isTokenFile),
      default: modes.default,
      values,
    })
    if (generated.size === 0) {
      modes = undefined
      break
    }
    // The selector code uses goes into the config, so later runs compare exactly that block (F14).
    if (modes.selector)
      files.set(
        CONFIG_FILE,
        configYaml(detected, tokenGroups, contracts.length > 0, include, design?.figmaInclude, {
          dark: modes.selector,
        }),
      )
    for (const [path, content] of generated) files.set(path, content)
    register = buildRegister([...files].map(([path, content]) => ({ path, content })))
    const bad = register.issues.filter((i) => i.severity === 'error' && i.file?.startsWith('modes/'))
    if (bad.length === 0) {
      modes.values = Object.fromEntries([...values].map(([c, v]) => [c, v.size]).filter(([, n]) => n !== 0))
      modes.contexts = [modes.default, ...Object.keys(modes.values)]
      break
    }
    for (const issue of bad) {
      const context = [...values.keys()].find((c) => issue.file === contextFile(c))
      if (context && issue.path) values.get(context)?.delete(issue.path)
      else if (context) values.delete(context)
    }
  }

  return {
    detected,
    source,
    openPoints,
    files,
    register,
    mappedVariables: [
      ...assignments
        .filter((a) => finalTokens.has(a.token.path))
        .map((a) => ({ token: a.token.path, variable: a.variable })),
      // Variables the design tool names for code (Figma code syntax) that the code really defines.
      ...[...finalTokens.values()].flatMap((t) => {
        const variable = t.accord?.ids?.css
        return variable && resolved.has(variable) && !assignments.some((a) => a.token.path === t.path)
          ? [{ token: t.path, variable }]
          : []
      }),
    ],
    components: contracts.map((c) => c.name as string),
    importIssues,
    modes,
  }
}

export async function writeInit(
  dir: string,
  files: ReadonlyMap<string, string>,
  force: boolean,
): Promise<'written' | 'written-kept-config' | 'exists'> {
  const exists = await stat(dir).then(
    () => true,
    () => false,
  )
  if (exists && !force) return 'exists'
  let keepConfig = false
  if (exists) {
    // Keep the lock file, generated output and the hand-maintained config (allow rules, ownership, name);
    // replace tokens, contracts and decisions.
    for (const sub of ['tokens', 'components', 'decisions'])
      await rm(join(dir, sub), { recursive: true, force: true })
    keepConfig = await stat(join(dir, CONFIG_FILE)).then(
      () => true,
      () => false,
    )
  }
  for (const [path, content] of files) {
    if (keepConfig && path === CONFIG_FILE) continue
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await writeFile(join(dir, path), content)
  }
  return keepConfig ? 'written-kept-config' : 'written'
}
