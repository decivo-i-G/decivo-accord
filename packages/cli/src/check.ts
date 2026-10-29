import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  codeModeSelectors,
  codeSnapshot,
  cssVariableName,
  type HardValueFinding,
  prepareCodeScan,
  scanPaths,
  withCodeContexts,
} from '@decivo/accord-adapter-code'
import {
  auditContrast,
  contextFallbacks,
  type Evaluation,
  evaluate,
  type LiteralUse,
  type Violation,
} from '@decivo/accord-checks'
import {
  type ColorValue,
  contextLabel,
  type DimensionValue,
  type Register,
  restrictTo,
  snapshotFromRegister,
  THEME_MODIFIER,
  threeWayDiff,
} from '@decivo/accord-core'
import { loadValidRegister } from '@decivo/accord-core/node'

/** Added line numbers per file from a unified diff (`git diff`). */
export function addedLines(diff: string): Map<string, Set<number>> {
  const files = new Map<string, Set<number>>()
  let current: Set<number> | undefined
  let line = 0
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const path = raw.slice(4).trim().replace(/^b\//, '')
      current = path === '/dev/null' ? undefined : (files.get(path) ?? new Set())
      if (current) files.set(path, current)
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (hunk) {
      line = Number(hunk[1])
      continue
    }
    if (!current || raw.startsWith('---')) continue
    if (raw.startsWith('+')) current.add(line++)
    else if (!raw.startsWith('-') && !raw.startsWith('\\')) line++
  }
  return files
}

export interface CheckInput {
  /** Repository root. */
  root: string
  /** Register directory (absolute, or relative to root). */
  registerDir: string
  /** Files to check, relative to root. */
  paths?: string[] | undefined
  /** Unified diff; only added lines are checked. */
  diff?: string | undefined
  register?: Register | undefined
}

export interface CheckFinding {
  decision: string
  level: 'must' | 'should'
  rule: string
  why: string
  fixHint?: string | undefined
  at: string
  value?: string | undefined
  replacement?: string | undefined
  /** CSS variable of the replacement token, ready to paste. */
  replacementVar?: string | undefined
  /** The context the finding is about (`dark`); absent for the default context. */
  context?: string | undefined
}

/** A hint that does not fail the check (F15: a colour shows its light value in dark). */
export interface CheckWarning {
  code: 'context_fallback'
  /** Token path without `tokens.`. */
  token: string
  context: string
}

export interface CheckResult {
  ok: boolean
  evaluation: Evaluation
  findings: CheckFinding[]
  files: string[]
  /** Hints, never a reason to fail. */
  warnings?: CheckWarning[] | undefined
}

const toLiteral = (h: HardValueFinding): LiteralUse => ({
  file: h.file,
  line: h.line,
  column: h.column,
  raw: h.raw,
  kind: h.kind,
  value: h.value as ColorValue | DimensionValue,
  replacement: h.match.exact[0],
  near: h.match.near,
  allowed: h.allowed,
  inlineOnly: h.inlineOnly,
})

/**
 * Check a change before it is committed or merged: hard-coded values in the touched files
 * (only added lines when a diff is given) and token changes in the configured stylesheets,
 * evaluated against the register's decisions. Used by `accord check`, the MCP tool and CI.
 */
export async function checkChange(input: CheckInput): Promise<CheckResult> {
  const root = resolve(input.root)
  const registerDir = isAbsolute(input.registerDir) ? input.registerDir : join(root, input.registerDir)
  const register = input.register ?? (await loadValidRegister(registerDir))
  const added = input.diff !== undefined ? addedLines(input.diff) : undefined
  // Only files inside the project are checked: a path from an agent or a diff (`../../.ssh/config`,
  // `+++ b/../x`) never makes Accord read and report from elsewhere.
  const files = [
    ...new Set(
      [...(input.paths ?? []), ...(added ? [...added.keys()] : [])]
        .map((p) => relative(root, resolve(root, p)))
        .filter((p) => p !== '' && !p.startsWith('..') && !isAbsolute(p)),
    ),
  ]

  const ctx = await prepareCodeScan({ root, register })
  const hardValues = (await scanPaths(ctx, files)).filter((h) => !added || added.get(h.file)?.has(h.line))

  // Token values edited in the stylesheet that defines them (or one it imports) are register changes proposed
  // from code, in every context code expresses (`.dark`).
  const touchesTokens = files.some(
    (f) => register.config.surfaces.code.css.includes(f) || ctx.stylesheets.includes(f),
  )
  const base = codeSnapshot(register.tokens.values(), ctx.resolved)
  const code = {
    ...base,
    snapshot: withCodeContexts(
      base.snapshot,
      register.tokens.values(),
      ctx.variables,
      codeModeSelectors(register, ctx.variables),
      register.modes?.modifier ?? THEME_MODIFIER,
    ),
  }
  const items = touchesTokens
    ? threeWayDiff({
        register: restrictTo(snapshotFromRegister(register), code.snapshot.coverage),
        surface: code.snapshot,
      }).filter((i) => i.op.kind !== 'token.removed')
    : []

  const evaluation = await evaluate({
    register,
    change: { source: 'code', intent: 'proposal', items, literals: hardValues.map(toLiteral) },
  })

  // A change to the register itself (token files, modes, resolver.json): contrast must hold in light and
  // dark, and colours that fall back to light in dark are pointed out (F15).
  const registerRel = relative(root, registerDir).split('\\').join('/')
  const touchesRegister = files.some(
    (f) => f.startsWith(`${registerRel}/`) && !/\/(proposals|generated)\//.test(f.slice(registerRel.length)),
  )
  const audit = touchesRegister ? auditContrast(register) : []

  const describe = (v: Violation): CheckFinding => {
    const token = v.replacement ? register.tokens.get(v.replacement) : undefined
    const value =
      typeof v.detail.value === 'string'
        ? v.detail.value
        : v.code === 'low_contrast'
          ? `${v.detail.ratio}:1 on ${v.detail.against}, needs ${v.detail.required}:1`
          : undefined
    return {
      decision: v.decisionId,
      level: v.level,
      rule: v.rule,
      why: v.why,
      fixHint: v.fixHint,
      at: v.at,
      value,
      replacement: v.replacement,
      replacementVar: token ? cssVariableName(token) : undefined,
      ...(typeof v.detail.context === 'string' ? { context: v.detail.context } : {}),
    }
  }
  const seen = new Set<string>()
  const findings = [
    ...evaluation.literalViolations,
    ...evaluation.items.flatMap((i) => i.violations),
    ...audit,
  ]
    .map(describe)
    .filter((f) => {
      const key = `${f.decision}|${f.at}|${f.context ?? ''}|${f.value ?? ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  const warnings: CheckWarning[] = [
    ...(evaluation.warnings ?? []).map((w) => ({
      code: w.code,
      token: w.at.replace(/^tokens\./, ''),
      context: contextLabel(w.context),
    })),
    ...(touchesRegister
      ? contextFallbacks(register).map((f) => ({
          code: 'context_fallback' as const,
          token: f.path,
          context: f.context,
        }))
      : []),
  ].filter((w, i, all) => all.findIndex((x) => x.token === w.token && x.context === w.context) === i)
  return {
    ok: !findings.some((f) => f.level === 'must'),
    evaluation,
    findings,
    files,
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}

/** One line per F15 hint, for terminals and agents. */
const warningLines = (result: CheckResult) =>
  (result.warnings ?? []).map(
    (w) =>
      `  Note: ${w.token} has no ${w.context} value of its own and shows its default value in ${w.context}.`,
  )

/** Plain-text report for agents and terminals, grouped by decision. */
export function formatCheck(result: CheckResult): string {
  if (result.findings.length === 0)
    return [`check_change: no violations in ${result.files.length} file(s).`, ...warningLines(result)].join(
      '\n',
    )
  const lines: string[] = []
  const must = result.findings.filter((f) => f.level === 'must').length
  lines.push(
    `check_change: ${result.findings.length} violation(s)${must > 0 ? `, ${must} must – fix before committing` : ''}.`,
  )
  const byDecision = new Map<string, CheckFinding[]>()
  for (const f of result.findings) byDecision.set(f.decision, [...(byDecision.get(f.decision) ?? []), f])
  for (const [id, list] of byDecision) {
    const first = list[0] as CheckFinding
    lines.push('', `${id} (${first.level}): ${first.rule}`, `  Why: ${first.why}`)
    if (first.fixHint) lines.push(`  Fix: ${first.fixHint}`)
    for (const f of list) {
      const fix = f.replacement
        ? ` → ${f.replacement}${f.replacementVar ? ` (var(${f.replacementVar}))` : ''}`
        : ''
      lines.push(`  ${f.at}${f.context ? ` (${f.context})` : ''}${f.value ? `  ${f.value}` : ''}${fix}`)
    }
  }
  const notes = warningLines(result)
  if (notes.length > 0) lines.push('', ...notes)
  return lines.join('\n')
}

const escapeData = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
const escapeProperty = (s: string) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C')

/**
 * GitHub Actions workflow commands: one annotation per finding at its line (`error` for must,
 * `warning` for should), shown in the pull request diff. `pathPrefix` is where the checked root lies
 * inside the repository (e.g. `apps/web`).
 */
export function formatGithubAnnotations(result: CheckResult, pathPrefix = ''): string {
  return result.findings
    .map((f) => {
      const [file, line, col] = f.at.split(':')
      // GitHub places annotations by path from the repository root.
      const path = pathPrefix ? `${pathPrefix.replace(/\/$/, '')}/${file}` : (file as string)
      const where = line ? `file=${escapeProperty(path)},line=${line},col=${col ?? 1},` : ''
      const fix = f.replacement
        ? ` Replace with ${f.replacement}${f.replacementVar ? ` (var(${f.replacementVar}))` : ''}.`
        : ''
      const message = `${f.rule}${f.value ? `: ${f.value}` : ''}.${fix} Why: ${f.why}`
      return `::${f.level === 'must' ? 'error' : 'warning'} ${where}title=${escapeProperty(`${f.decision} (${f.level})`)}::${escapeData(message)}`
    })
    .join('\n')
}

/** Markdown summary for the job page (`$GITHUB_STEP_SUMMARY`) or a pull request comment. */
export function formatMarkdownSummary(result: CheckResult): string {
  if (result.findings.length === 0)
    return `### ✅ decivo Accord\n\nNo violations in ${result.files.length} changed file(s).\n`
  const must = result.findings.filter((f) => f.level === 'must').length
  const lines = [
    `### ${must > 0 ? '❌' : '⚠️'} decivo Accord`,
    '',
    `${result.findings.length} violation(s) in ${new Set(result.findings.map((f) => f.at.split(':')[0])).size} file(s)${must > 0 ? `, ${must} must` : ''}.`,
    '',
    '| Decision | Where | Value | Replace with |',
    '| --- | --- | --- | --- |',
  ]
  for (const f of result.findings) {
    const replace = f.replacement
      ? `\`${f.replacement}\`${f.replacementVar ? ` (\`var(${f.replacementVar})\`)` : ''}`
      : '–'
    lines.push(
      `| ${f.decision} (${f.level}) | \`${f.at}\` | ${f.value ? `\`${f.value}\`` : '–'} | ${replace} |`,
    )
  }
  const decisions = new Map(result.findings.map((f) => [f.decision, f]))
  lines.push('')
  for (const [id, f] of decisions) lines.push(`- **${id}** ${f.rule} – ${f.why}`)
  return `${lines.join('\n')}\n`
}
