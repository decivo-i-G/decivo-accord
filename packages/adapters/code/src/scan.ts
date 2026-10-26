import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type AllowRule,
  type ColorValue,
  cssToColor,
  cssToDimension,
  type DimensionValue,
  dimensionToPx,
  type Register,
  type RegisterModes,
  THEME_MODIFIER,
  valuesEqual,
} from '@decivo/accord-core'
import { glob } from 'tinyglobby'
import { type CssVariable, linkedVariables, type ResolvedVariable, resolveCssVariables } from './css-vars.js'
import { type HardValue, scanScript, scanStylesheet } from './hard-values.js'
import { buildTokenIndex, matchColor, matchDimension, type TokenIndex, type TokenMatch } from './match.js'
import {
  type CodeModeSelector,
  type CodeSnapshot,
  codeModeSelectors,
  codeSnapshot,
  cssVariableName,
  withCodeContexts,
} from './snapshot.js'
import { readStylesheets, type SkippedImport } from './stylesheets.js'
import { countTokenUses, countVariableUsage } from './usage.js'

export interface HardValueFinding extends HardValue {
  match: TokenMatch
  /** Reason from a matching `surfaces.code.allow` rule; allowed values are reported, not counted. */
  allowed?: string
}

export interface UnmappedVariable {
  variable: ResolvedVariable
  /** Register tokens with the same value: candidates for `ids.css`. */
  match: TokenMatch
}

export interface CodeScan extends CodeSnapshot {
  variables: Map<string, ResolvedVariable>
  /** Base-scope variables holding a colour that no register token maps to. */
  unmapped: UnmappedVariable[]
  hardValues: HardValueFinding[]
  filesScanned: number
  /** Uses of each register token's CSS variable in the scanned files, by token path (alias uses included). */
  tokenUsage: Map<string, number>
  /** Usage sites of colour tokens, each counted once. */
  colorTokenUses: number
  /** How code expresses each non-default context of the register (empty without modes). */
  modes: CodeModeSelector[]
  /** Stylesheets read for variables, imports included. */
  stylesheets: string[]
  /** `@import`s that were not followed. */
  skippedImports: SkippedImport[]
}

const SCRIPT = /\.(?:[cm]?[jt]sx?)$/
const STYLE = /\.css$/

export interface ScanOptions {
  /** Repository root; config globs are relative to it. */
  root: string
  register: Pick<Register, 'config' | 'tokens'> & { modes?: RegisterModes | undefined }
}

/** Everything a scan needs that is computed once per repository: variables, token index, rules. */
export interface CodeScanContext {
  root: string
  register: ScanOptions['register']
  /** Every custom property declaration, in cascade order, imports included. */
  variables: CssVariable[]
  stylesheets: string[]
  skippedImports: SkippedImport[]
  resolved: Map<string, ResolvedVariable>
  /** All files matched by `surfaces.code.include`, with content. */
  files: { path: string; content: string }[]
  index: TokenIndex
  tokenUsage: Map<string, number>
  colorTokenUses: number
  isInlineOnly: (path: string) => boolean
  isExcluded: (path: string) => boolean
  allowed: (value: HardValue) => string | undefined
}

/**
 * Read the repository once: CSS variables, every included file, and how often each token's variable
 * is used (so replacements point to tokens the code already uses).
 */
export async function prepareCodeScan({ root, register }: ScanOptions): Promise<CodeScanContext> {
  const { include, exclude, css, inline_only, allow } = register.config.surfaces.code

  const sheets = await readStylesheets(root, css)
  const variables = sheets.variables
  const resolved = resolveCssVariables(variables)
  const tokens = [...register.tokens.values()]

  const paths = (await glob(include, { cwd: root, ignore: exclude })).sort()
  const files = await Promise.all(
    paths.map(async (path) => ({ path, content: await readFile(join(root, path), 'utf8') })),
  )
  const included = new Set(paths)

  const variableUsage = countVariableUsage(
    files.map((f) => f.content),
    resolved,
  )
  const tokenUsage = new Map(tokens.map((t) => [t.path, variableUsage.get(cssVariableName(t)) ?? 0]))
  const colorTokenUses = countTokenUses(
    files.map((f) => f.content),
    resolved,
    new Set(tokens.filter((t) => t.type === 'color').map(cssVariableName)),
  )
  const inlineOnlyFiles = new Set(await glob(inline_only, { cwd: root, ignore: exclude }))

  return {
    root,
    register,
    variables,
    stylesheets: sheets.files,
    skippedImports: sheets.skipped,
    resolved,
    files,
    index: buildTokenIndex(
      tokens,
      tokenUsage,
      resolved.size > 0
        ? new Set(tokens.filter((t) => resolved.has(cssVariableName(t))).map((t) => t.path))
        : undefined,
    ),
    tokenUsage,
    colorTokenUses,
    isInlineOnly: (path) => inlineOnlyFiles.has(path),
    isExcluded: (path) => !included.has(path),
    allowed: await allowMatcher(allow, root, exclude),
  }
}

/** Hard-coded values in one file, mapped to tokens and marked as allowed or inline-only. */
export function scanSource(ctx: CodeScanContext, path: string, content: string): HardValueFinding[] {
  const near = ctx.register.config.matching.color_near_delta_e
  // Custom property definitions are skipped inside scanStylesheet; other literal colours count, also in globals.css.
  const found = STYLE.test(path)
    ? scanStylesheet(content, path)
    : SCRIPT.test(path)
      ? scanScript(content, path)
      : []
  return found.map((value) => {
    const match =
      value.kind === 'color'
        ? matchColor(ctx.index, value.value as ColorValue, near)
        : matchDimension(ctx.index, value.value as DimensionValue, value.category)
    const reason = ctx.allowed(value)
    return {
      ...value,
      ...(ctx.isInlineOnly(path) ? { inlineOnly: true as const } : {}),
      ...(reason !== undefined ? { allowed: reason } : {}),
      match,
    }
  })
}

/** Scan selected files (e.g. those touched by a commit). Files outside `include` or in `exclude` are skipped. */
export async function scanPaths(ctx: CodeScanContext, paths: readonly string[]): Promise<HardValueFinding[]> {
  const out: HardValueFinding[] = []
  for (const path of paths) {
    if (ctx.isExcluded(path)) continue
    const content =
      ctx.files.find((f) => f.path === path)?.content ??
      (await readFile(join(ctx.root, path), 'utf8').catch(() => undefined))
    if (content !== undefined) out.push(...scanSource(ctx, path, content))
  }
  return out
}

/** Read the code surface: CSS variables (→ snapshot), unmapped variables and hard-coded values. */
export async function scanCode(options: ScanOptions): Promise<CodeScan> {
  const ctx = await prepareCodeScan(options)
  const { register, resolved, index } = ctx
  const tokens = [...register.tokens.values()]
  const base = codeSnapshot(tokens, resolved)
  const modes = codeModeSelectors(register, ctx.variables)
  const result = {
    ...base,
    snapshot: withCodeContexts(
      base.snapshot,
      tokens,
      ctx.variables,
      modes,
      register.modes?.modifier ?? THEME_MODIFIER,
    ),
  }

  // Variables connected to a token (its own, the ones it points to, aliases of it) are not "without token".
  const mappedNames = linkedVariables(resolved, tokens.map(cssVariableName))
  const unmapped: UnmappedVariable[] = []
  for (const variable of resolved.values()) {
    if (mappedNames.has(variable.name) || variable.resolved === undefined) continue
    const color = cssToColor(variable.resolved)
    if (!color || !/^(#|rgb|hsl|oklch|oklab|lab|lch|hwb|color\()/i.test(variable.resolved)) continue
    unmapped.push({
      variable,
      match: matchColor(index, color, register.config.matching.color_near_delta_e, variable.name),
    })
  }

  return {
    ...result,
    variables: resolved,
    unmapped,
    hardValues: ctx.files.flatMap((f) => scanSource(ctx, f.path, f.content)),
    filesScanned: ctx.files.length,
    tokenUsage: ctx.tokenUsage,
    colorTokenUses: ctx.colorTokenUses,
    modes,
    stylesheets: ctx.stylesheets,
    skippedImports: ctx.skippedImports,
  }
}

/** Returns the reason of the first allow rule a hard value falls under. */
async function allowMatcher(rules: readonly AllowRule[], root: string, exclude: string[]) {
  const prepared = await Promise.all(
    rules.map(async (rule) => ({
      reason: rule.reason,
      files: rule.files ? new Set(await glob(rule.files, { cwd: root, ignore: exclude })) : undefined,
      colors: rule.values?.map((v) => cssToColor(v)).filter((c) => c !== undefined),
      dimensions: rule.values?.map((v) => cssToDimension(v)).filter((d) => d !== undefined),
    })),
  )
  return (value: HardValue): string | undefined => {
    for (const rule of prepared) {
      if (rule.files && !rule.files.has(value.file)) continue
      if (rule.colors || rule.dimensions) {
        const hit =
          value.kind === 'color'
            ? (rule.colors ?? []).some((c) => valuesEqual('color', c, value.value))
            : (rule.dimensions ?? []).some(
                (d) => Math.abs(dimensionToPx(d) - dimensionToPx(value.value as DimensionValue)) < 0.01,
              )
        if (!hit) continue
      }
      return rule.reason
    }
    return undefined
  }
}
