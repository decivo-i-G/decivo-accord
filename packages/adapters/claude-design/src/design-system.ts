import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import {
  type CodeModeSelector,
  type CodeSnapshot,
  type CssVariable,
  codeModeSelectors,
  codeSnapshot,
  cssVariableName,
  isDefaultThemeScope,
  parseCssVariables,
  resolveCssVariables,
  scopeMatches,
  scopeOf,
  withCodeContexts,
} from '@decivo/accord-adapter-code'
import {
  contextLabel,
  type DriftItem,
  type Lock,
  lockedSnapshot,
  type Register,
  registerInContext,
  restrictTo,
  snapshotFromRegister,
  THEME_MODIFIER,
  type Token,
  threeWayDiff,
} from '@decivo/accord-core'
import { valueToCss } from '@decivo/accord-generators'
import postcss, { type Container, type Root } from 'postcss'

/**
 * A local mirror of a Claude Design design-system project. Claude Code fills it with `/design-sync`
 * (DesignSync `list_files` / `get_file`); Accord reads it like any other surface.
 */
export interface DesignSystemMirror {
  dir: string
  /** Stylesheets in the project, relative to `dir`. Inline `<style>` blocks of preview cards are included. */
  styles: { path: string; css: string }[]
}

/** Name of a token's variable in Claude Design: `ids.claudeDesign`, else the same as in code. */
export const designVariableName = (token: Token) => token.accord?.ids?.claudeDesign ?? cssVariableName(token)

export async function readDesignSystemMirror(dir: string): Promise<DesignSystemMirror> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  const styles: DesignSystemMirror['styles'] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const full = join(entry.parentPath, entry.name)
    const path = relative(dir, full).split(sep).join('/')
    if (/\.css$/i.test(path)) styles.push({ path, css: await readFile(full, 'utf8') })
    else if (/\.html?$/i.test(path)) {
      const html = await readFile(full, 'utf8')
      const blocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] as string)
      if (blocks.length > 0) styles.push({ path, css: blocks.join('\n') })
    }
  }
  return { dir, styles: styles.sort((a, b) => a.path.localeCompare(b.path)) }
}

export interface DesignSystemStatus {
  snapshot: CodeSnapshot['snapshot']
  /** Differences to the register, judged against the last sync (lock entry `claude-design`). */
  items: DriftItem[]
  /** Register tokens the project does not define (not counted as drift). */
  missing: string[]
  /** Register contexts compared with the project (e.g. `dark`); empty without modes or without a block for them. */
  contexts: string[]
  /** How the project expresses each non-default context, as for code (F14). */
  selectors: CodeModeSelector[]
}

/**
 * Selector per context: `surfaces.claude_design.modes`, else the code's `surfaces.code.modes` (the project
 * usually copies the product's stylesheet), else detected for `dark`. A selector taken over from the code
 * that the project does not use falls back to detection, so a project with its own `.dark` is still compared.
 */
export function designModeSelectors(
  register: Register,
  variables: readonly CssVariable[],
): CodeModeSelector[] {
  const { surfaces } = register.config
  const select = (modes: Record<string, string> | undefined) =>
    codeModeSelectors(
      { config: { surfaces: { ...surfaces, code: { ...surfaces.code, modes } } }, modes: register.modes },
      variables,
    )
  if (surfaces.claude_design.modes) return select(surfaces.claude_design.modes)
  const inherited = select(surfaces.code.modes)
  if (!surfaces.code.modes) return inherited
  const detected = select(undefined)
  return inherited.map((s, i) => (s.found ? s : (detected[i] ?? s)))
}

/**
 * Compare the Claude Design project with the register. Only tokens the project defines are compared, in the
 * default context and in every context the project has a block for (`.dark`).
 */
export function designSystemStatus(
  mirror: DesignSystemMirror,
  register: Register,
  lock: Lock,
): DesignSystemStatus {
  const variables = mirror.styles.flatMap((s) => parseCssVariables(s.css, s.path))
  const result = codeSnapshot(register.tokens.values(), resolveCssVariables(variables), designVariableName)
  // Tokens the project does not define are outside its coverage, so they never count as deletions.
  const present = result.snapshot.coverage.tokens.filter((p) => !result.missing.includes(p))
  const selectors = designModeSelectors(register, variables)
  const snapshot = withCodeContexts(
    { ...result.snapshot, coverage: { tokens: present, components: [] } },
    register.tokens.values(),
    variables,
    selectors,
    register.modes?.modifier ?? THEME_MODIFIER,
    designVariableName,
  )
  const items = threeWayDiff({
    base: lockedSnapshot(lock, 'claude-design'),
    register: restrictTo(snapshotFromRegister(register), snapshot.coverage),
    surface: snapshot,
  })
  const contexts = selectors.filter((s) => s.selector !== undefined && s.found).map((s) => s.context)
  return { snapshot, items, missing: result.missing, contexts, selectors }
}

export interface ResetFile {
  path: string
  content: string
  /** `context` is set for values in a non-default context (`dark`); `from` is undefined for added values. */
  changes: { variable: string; from?: string | undefined; to: string; context?: string | undefined }[]
}

/**
 * Why a difference is left for a person: `no-block` (no block for the context), `alias` (the variable points
 * to another one with `var()`; rewriting it would cut the link, e.g. to the dark value), `not-in-css` (only
 * declared outside a stylesheet, e.g. in an HTML `<style>`), `unsupported` (not a changed value).
 */
export type ResetSkipReason = 'no-block' | 'alias' | 'not-in-css' | 'unsupported'

export interface ResetPlan {
  files: ResetFile[]
  /** Differences the plan does not reset; `context` is '' for the default context. */
  skipped: { path: string; context: string; reason: ResetSkipReason }[]
}

/**
 * Files to upload with `/design-sync` so the project matches the register again: every value that
 * drifted is rewritten in place, in the block of its context (formatting and everything else in the file
 * stays as it is). A context value the project lacks is added to the first block of that context.
 */
export function resetPlan(
  mirror: DesignSystemMirror,
  register: Register,
  status: Pick<DesignSystemStatus, 'items' | 'selectors'>,
): ResetPlan {
  // Target values per context ('' is the default context), keyed by variable name.
  const targets = new Map<string, Map<string, { path: string; value: string }>>()
  const skipped: ResetPlan['skipped'] = []
  for (const item of status.items) {
    const op = item.op
    if (op.kind !== 'token.value_changed') {
      skipped.push({ path: op.path.replace(/^tokens\./, ''), context: '', reason: 'unsupported' })
      continue
    }
    const context = op.context ? contextLabel(op.context) : ''
    const path = op.path.replace(/^tokens\./, '')
    const token = registerInContext(register, context || undefined).tokens.get(path)
    const value = token ? valueToCss(token) : undefined
    if (!token || !value) {
      skipped.push({ path, context, reason: 'unsupported' })
      continue
    }
    const forContext = targets.get(context) ?? new Map()
    forContext.set(designVariableName(token), { path, value })
    targets.set(context, forContext)
  }

  const selectorOf = new Map(status.selectors.flatMap((s) => (s.selector ? [[s.context, s.selector]] : [])))
  const contextOfScope = (scope: string): string | undefined => {
    if (scope === 'base' || isDefaultThemeScope(scope)) return ''
    for (const [context, selector] of selectorOf) if (scopeMatches(scope, selector)) return context
    return undefined
  }

  const sheets = mirror.styles
    .filter((s) => /\.css$/i.test(s.path))
    .map((s) => ({
      path: s.path,
      root: postcss.parse(s.css, { from: s.path }),
      changes: [] as ResetFile['changes'],
    }))
  const done = new Set<string>()
  const aliased = new Set<string>()
  for (const sheet of sheets) {
    sheet.root.walkDecls(/^--/, (decl) => {
      const context = contextOfScope(scopeOf(decl.parent as Container))
      const target = context === undefined ? undefined : targets.get(context)?.get(decl.prop)
      if (context === undefined || !target) return
      done.add(`${context}|${decl.prop}`)
      if (decl.value.trim() === target.value) return
      // `--color-background: var(--bg)` gets its value per context through `--bg`; a fixed value here would
      // also replace the dark one. The variable it points to may be shared, so a person decides.
      if (/\bvar\(/i.test(decl.value)) {
        aliased.add(`${context}|${decl.prop}`)
        return
      }
      sheet.changes.push({
        variable: decl.prop,
        from: decl.value.trim(),
        to: target.value,
        ...(context ? { context } : {}),
      })
      decl.value = target.value
    })
  }

  // Context values the project falls back for: add them to the context's first block.
  for (const [context, forContext] of targets) {
    for (const [variable, target] of forContext) {
      const key = `${context}|${variable}`
      if (aliased.has(key)) {
        skipped.push({ path: target.path, context, reason: 'alias' })
        continue
      }
      if (done.has(key)) continue
      if (!context) {
        skipped.push({ path: target.path, context, reason: 'not-in-css' })
        continue
      }
      const block = firstBlock(sheets, (scope) => contextOfScope(scope) === context)
      if (!block) {
        skipped.push({ path: target.path, context, reason: 'no-block' })
        continue
      }
      block.container.append({ prop: variable, value: target.value })
      block.sheet.changes.push({ variable, to: target.value, context })
    }
  }

  const files = sheets
    .filter((s) => s.changes.length > 0)
    .map((s) => ({ path: s.path, content: s.root.toString(), changes: s.changes }))
  return { files, skipped }
}

function firstBlock<S extends { root: Root }>(
  sheets: S[],
  matches: (scope: string) => boolean,
): { sheet: S; container: Container } | undefined {
  for (const sheet of sheets) {
    let found: Container | undefined
    sheet.root.walkRules((rule) => {
      if (!found && matches(scopeOf(rule))) found = rule
    })
    if (found) return { sheet, container: found }
  }
  return undefined
}
