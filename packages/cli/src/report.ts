import type { CodeModeSelector, CodeScan } from '@decivo/accord-adapter-code'
import { auditContrast, contextFallbacks } from '@decivo/accord-checks'
import {
  type DriftOrigin,
  formatValue,
  type Issue,
  type Lock,
  lockedSnapshot,
  type ModeContext,
  type Owner,
  otherContexts,
  type Register,
  resolveOwner,
  restrictTo,
  snapshotFromRegister,
  threeWayDiff,
} from '@decivo/accord-core'

/** Everything the drift report shows; the same shape is printed as text, emitted as JSON and later rendered in the web app. */
export interface DriftReport {
  generatedAt: string
  register: { tokens: number; components: number; decisions: number; issues: Issue[] }
  health: { score: number; preliminary: true; parts: { tokenSync: number; hardValues: number } }
  /** The register's contexts (light/dark) and how they hold up; absent for a register without modes. */
  modes?:
    | {
        default: string
        contexts: string[]
        /** Colours with no value of their own in a context: they show the default there (F15, a hint). */
        fallbacks: { context: string; tokens: string[] }[]
        /** `min_contrast` rules that do not hold, per context. */
        contrast: {
          decision: string
          at: string
          against: string
          ratio: number
          required: number
          context?: string | undefined
        }[]
      }
    | undefined
  code: {
    tokensCovered: number
    tokensInSync: number
    drift: DriftEntry[]
    missing: string[]
    unreadable: CodeScan['unreadable']
    unmapped: { name: string; value: string; candidates: string[]; near?: string | undefined }[]
    /** Hard values in normal UI code. */
    hardValues: HardValueEntry[]
    hardValueSummary: { total: number; exact: number; near: number; none: number; files: number }
    /** Hard values in e-mail, PDF and OG-image code, where CSS variables do not work. Not counted against health. */
    inlineOnly: { total: number; files: { file: string; count: number }[] }
    /** Hard values covered by a justified `allow` rule. Not counted. */
    allowed: { total: number; reasons: { reason: string; count: number }[] }
    /** Share of colour usages that go through a token (preliminary: var() and Tailwind theme classes vs. hard-coded colours). */
    adoption: { tokenUses: number; hardColours: number; rate: number }
    /** How often each token's CSS variable is referenced in the scanned code (token path → count). */
    tokenUsage?: Record<string, number> | undefined
    filesScanned: number
    /** How code expresses each non-default context (light/dark); absent for a register without modes. */
    modes?: CodeModeSelector[] | undefined
  }
}

export interface DriftEntry {
  path: string
  /** The context the difference is in (`{ theme: 'dark' }`); absent for the default context. */
  context?: ModeContext | undefined
  /** In a context: the side without an own value there (`after`: code lacks the dark value). */
  fallback?: 'before' | 'after' | undefined
  kind: string
  origin: DriftOrigin
  owner: Owner
  breaking: boolean
  reason: string
  register?: string | undefined
  surface?: string | undefined
}

export interface HardValueEntry {
  file: string
  line: number
  column: number
  raw: string
  kind: 'color' | 'dimension'
  context: string
  replacement?: string | undefined
  near?: { path: string; distance: number } | undefined
}

/**
 * Preliminary health score (to be fixed in the phase 0 review):
 * half from tokens in sync between register and code, half from hard-coded colours per scanned file.
 * Exported so that views which count something differently (e.g. the web app, which does not count a token
 * that only waits for code to follow a decision) still use the one formula.
 */
export function healthScore(inSync: number, covered: number, hardColours: number, files: number) {
  const tokenSync = covered === 0 ? 1 : inSync / covered
  const perFile = files === 0 ? 0 : hardColours / files
  const hardValues = 1 / (1 + perFile * 2)
  return { score: Math.round(100 * (0.5 * tokenSync + 0.5 * hardValues)), parts: { tokenSync, hardValues } }
}

function adoption(scan: CodeScan, hardColours: number) {
  const tokenUses = scan.colorTokenUses
  const total = tokenUses + hardColours
  return { tokenUses, hardColours, rate: total === 0 ? 1 : Math.round((tokenUses / total) * 100) / 100 }
}

export function buildDriftReport(
  register: Register,
  scan: CodeScan,
  lock: Lock,
  now = new Date(),
): DriftReport {
  const registerSnapshot = restrictTo(snapshotFromRegister(register), scan.snapshot.coverage)
  const items = threeWayDiff({
    base: lockedSnapshot(lock, 'code'),
    register: registerSnapshot,
    surface: scan.snapshot,
  })

  const drift: DriftEntry[] = items
    .filter((item) => item.op.kind !== 'token.removed') // missing variables are listed separately
    .map(({ op, origin, classification }) => {
      const entry: DriftEntry = {
        path: op.path,
        kind: op.kind,
        origin,
        owner: resolveOwner(register, op.path, classification.aspect).owner,
        breaking: classification.breaking,
        reason: classification.reason,
      }
      if (op.kind === 'token.value_changed') {
        entry.register = formatValue(op.type, op.before)
        entry.surface = formatValue(op.type, op.after)
        if (op.context) entry.context = op.context
        if (op.fallback) entry.fallback = op.fallback
      }
      if (op.kind === 'token.alias_changed' && op.context) entry.context = op.context
      return entry
    })

  const covered = scan.snapshot.coverage.tokens.length
  // A token that differs in light and in dark is one token out of sync.
  const drifting = new Set(drift.filter((d) => d.kind.startsWith('token.')).map((d) => d.path))
  const inSync = covered - scan.missing.length - drifting.size

  const inlineFiles = new Map<string, number>()
  const allowedReasons = new Map<string, number>()
  for (const h of scan.hardValues)
    if (h.allowed) allowedReasons.set(h.allowed, (allowedReasons.get(h.allowed) ?? 0) + 1)
  for (const h of scan.hardValues)
    if (h.inlineOnly && !h.allowed) inlineFiles.set(h.file, (inlineFiles.get(h.file) ?? 0) + 1)
  const hardValues: HardValueEntry[] = scan.hardValues
    .filter((h) => !h.inlineOnly && !h.allowed)
    .map((h) => ({
      file: h.file,
      line: h.line,
      column: h.column,
      raw: h.raw,
      kind: h.kind,
      context: h.context,
      replacement: h.match.exact[0],
      near: h.match.near,
    }))
  const hardColours = hardValues.filter((h) => h.kind === 'color').length
  const health = healthScore(inSync, covered, hardColours, scan.filesScanned)

  const modes = register.modes
    ? {
        default: register.modes.default,
        contexts: register.modes.contexts,
        fallbacks: otherContexts(register).map((context) => ({
          context,
          tokens: contextFallbacks(register)
            .filter((f) => f.context === context)
            .map((f) => f.path),
        })),
        contrast: auditContrast(register).map((v) => ({
          decision: v.decisionId,
          at: v.at,
          against: String(v.detail.against),
          ratio: Number(v.detail.ratio),
          required: Number(v.detail.required),
          ...(typeof v.detail.context === 'string' ? { context: v.detail.context } : {}),
        })),
      }
    : undefined

  return {
    generatedAt: now.toISOString(),
    register: {
      tokens: register.tokens.size,
      components: register.components.size,
      decisions: register.decisions.size,
      issues: register.issues,
    },
    health: { score: health.score, preliminary: true, parts: health.parts },
    ...(modes ? { modes } : {}),
    code: {
      tokensCovered: covered,
      tokensInSync: inSync,
      drift,
      missing: scan.missing,
      unreadable: scan.unreadable,
      unmapped: scan.unmapped.map((u) => ({
        name: u.variable.name,
        value: u.variable.resolved ?? u.variable.value,
        candidates: u.match.exact,
        near: u.match.near?.path,
      })),
      hardValues,
      hardValueSummary: {
        total: hardValues.length,
        exact: hardValues.filter((h) => h.replacement).length,
        near: hardValues.filter((h) => !h.replacement && h.near).length,
        none: hardValues.filter((h) => !h.replacement && !h.near).length,
        files: new Set(hardValues.map((h) => h.file)).size,
      },
      allowed: {
        total: [...allowedReasons.values()].reduce((a, b) => a + b, 0),
        reasons: [...allowedReasons]
          .map(([reason, count]) => ({ reason, count }))
          .sort((a, b) => b.count - a.count),
      },
      inlineOnly: {
        total: [...inlineFiles.values()].reduce((a, b) => a + b, 0),
        files: [...inlineFiles].map(([file, count]) => ({ file, count })).sort((a, b) => b.count - a.count),
      },
      adoption: adoption(scan, hardColours),
      tokenUsage: Object.fromEntries(scan.tokenUsage),
      filesScanned: scan.filesScanned,
      ...(scan.modes.length > 0 ? { modes: scan.modes } : {}),
    },
  }
}
