import { readFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type ColorValue, colorToHex, type Register } from '@decivo/accord-core'
import type { HandoffProposal } from './claude-design.js'
import type { DriftReport } from './report.js'

/**
 * The drift report as JSON (schema accord.report/1, see docs/report-format.md) and the webhook that sends it.
 * Only metadata leaves the repository: no source lines (`context`), no unmapped variables.
 * Lists are capped so a large repository still reports instead of failing. The schema and its fields are a
 * contract with existing receivers: do not rename or drop a field without a new schema version.
 */

export const REPORT_SCHEMA = 'accord.report/1'
export const MAX_HARD_VALUES = 3000
export const MAX_DRIFT = 500
export const MAX_RAW = 64
export const MAX_PROPOSALS = 50
export const MAX_PROPOSAL_COLORS = 20

/**
 * A proposal that needs a person: route `owner`, or anything breaking. A receiver can show it as an open
 * decision; Accord stays the engine and brings the recommendation.
 */
export interface ReportProposal {
  id: string
  source: HandoffProposal['source']
  title: string
  route: HandoffProposal['route']
  decider?: 'design' | 'code' | 'register' | undefined
  breaking: boolean
  colors: { token?: string; before?: string; after: string; count?: number }[]
  rules: { id: string; rule: string; why: string }[]
  recommendation: { option: 'adopt' | 'reset' | 'ask'; reason: string }
}

/** Proposals from `.accord/proposals/`; unreadable files are skipped, never sent half. */
export async function loadProposals(registerDir: string): Promise<HandoffProposal[]> {
  const dir = join(registerDir, 'proposals')
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.json')).sort()
  const out: HandoffProposal[] = []
  for (const name of names) {
    try {
      const proposal = JSON.parse(await readFile(join(dir, name), 'utf8')) as HandoffProposal
      if (typeof proposal?.id === 'string' && Array.isArray(proposal.violations)) out.push(proposal)
    } catch {
      // Not a proposal (or broken): skip it rather than send part of it.
    }
  }
  return out
}

const HEX = /^#[0-9a-f]{6}$/

/**
 * The proposals that wait for a person: route `owner` and not yet decided (a decided proposal keeps its
 * `resolution` as history and is not sent again). Only hex colours and rule texts leave Accord, no file contents.
 */
export function toReportProposals(
  proposals: readonly HandoffProposal[],
  register: Register,
): ReportProposal[] {
  return (
    proposals
      // accord.report/1 carries handoff proposals only; Figma and Pencil proposals stay in the register
      // until the schema knows them.
      .filter(
        (p) =>
          p.source === 'claude-design' && p.route === 'owner' && !(p as { resolution?: unknown }).resolution,
      )
      .slice(0, MAX_PROPOSALS)
      .map((p) => {
        const colors: ReportProposal['colors'] = []
        for (const v of p.violations) {
          const after = v.value.toLowerCase()
          if (!HEX.test(after) || colors.some((c) => c.after === after)) continue
          const token = v.nearest ? register.tokens.get(v.nearest) : undefined
          const before =
            token && token.type === 'color' && token.value !== undefined
              ? colorToHex(token.value as ColorValue)
              : undefined
          colors.push(
            before && v.nearest
              ? { token: v.nearest, before, after, count: v.count }
              : { after, count: v.count },
          )
          if (colors.length === MAX_PROPOSAL_COLORS) break
        }
        const rules: ReportProposal['rules'] = []
        for (const v of p.violations)
          if (!rules.some((r) => r.id === v.decision))
            rules.push({ id: v.decision, rule: v.rule, why: v.why })
        // A close token means the draft only drifted: put it back. Without one the owner has to decide.
        const option = colors.some((c) => c.token) ? 'reset' : 'ask'
        return {
          id: p.id,
          source: p.source,
          title: `${p.bundle.name} (Claude Design)`,
          route: p.route,
          decider: p.decider,
          breaking: false,
          colors,
          rules,
          recommendation: { option, reason: rules.map((r) => r.why).join(' ') },
        }
      })
  )
}

export interface ReportMeta {
  commit: string
  branch: string
  defaultBranch: string
  source: 'action' | 'cli'
  generatedAt?: string
}

export function accordVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version?: string
    }
    return pkg.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export function toReportPayload(
  report: DriftReport,
  meta: ReportMeta,
  version = accordVersion(),
  proposals: readonly ReportProposal[] = [],
) {
  const { code } = report
  return {
    schema: REPORT_SCHEMA,
    accord_version: version,
    commit: meta.commit,
    branch: meta.branch,
    default_branch: meta.defaultBranch,
    source: meta.source,
    generated_at: meta.generatedAt ?? report.generatedAt,
    report: {
      generatedAt: report.generatedAt,
      register: {
        tokens: report.register.tokens,
        components: report.register.components,
        decisions: report.register.decisions,
      },
      health: { score: Math.round(report.health.score) },
      code: {
        tokensCovered: code.tokensCovered,
        tokensInSync: code.tokensInSync,
        drift: code.drift.slice(0, MAX_DRIFT).map((d) => ({
          path: d.path,
          kind: d.kind,
          origin: d.origin,
          owner: d.owner,
          breaking: d.breaking,
          reason: d.reason,
          ...(d.register !== undefined ? { register: d.register } : {}),
          ...(d.surface !== undefined ? { surface: d.surface } : {}),
        })),
        missing: code.missing.slice(0, MAX_DRIFT),
        hardValues: code.hardValues
          .filter((h) => h.raw.length <= MAX_RAW)
          .slice(0, MAX_HARD_VALUES)
          .map((h) => ({
            file: h.file,
            line: h.line,
            column: h.column,
            raw: h.raw,
            kind: h.kind,
            ...(h.replacement ? { replacement: h.replacement } : {}),
            ...(h.near ? { near: { path: h.near.path, distance: h.near.distance } } : {}),
          })),
        hardValueSummary: code.hardValueSummary,
        inlineOnly: {
          total: code.inlineOnly.total,
          files: code.inlineOnly.files.slice(0, MAX_DRIFT),
        },
        allowed: code.allowed,
        adoption: code.adoption,
        filesScanned: code.filesScanned,
      },
    },
    proposals,
  }
}

export type ReportPayload = ReturnType<typeof toReportPayload>

/** Why the report was not sent. The token never appears in it; `endpoint` leaves out credentials and the query. */
export type ReportFailure =
  | { kind: 'invalid-url' }
  | { kind: 'insecure-url'; host: string }
  | { kind: 'unreachable'; endpoint: string; detail: string }
  | { kind: 'rejected'; endpoint: string; status: number; detail: string }

export class ReportError extends Error {
  constructor(readonly failure: ReportFailure) {
    super(failure.kind)
    this.name = 'ReportError'
  }
}

/** Plain http is only allowed to this machine. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Check the webhook address before anything is sent: https everywhere, plain http only to this machine
 * (localhost, 127.0.0.1, ::1), because otherwise the report and the token would travel unencrypted.
 */
export function checkReportUrl(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ReportError({ kind: 'invalid-url' })
  }
  if (parsed.protocol === 'https:') return parsed
  if (parsed.protocol === 'http:') {
    if (LOOPBACK.has(parsed.hostname)) return parsed
    throw new ReportError({ kind: 'insecure-url', host: parsed.hostname })
  }
  throw new ReportError({ kind: 'invalid-url' })
}

/**
 * POST the report to exactly `url`, nothing is added to the path. With a token, as `Authorization: Bearer
 * <token>`; without one, no auth header. Throws `ReportError` on a bad address, a network failure or a
 * non-2xx answer, with the receiver's own message when it gives one.
 */
export async function sendReport(input: {
  url: string
  token?: string | undefined
  payload: ReportPayload
  fetch?: typeof fetch
}): Promise<{ status: number; created?: boolean }> {
  const parsed = checkReportUrl(input.url)
  const endpoint = `${parsed.origin}${parsed.pathname}`
  const token = input.token || undefined
  const redact = (text: string) => (token ? text.split(token).join('[redacted]') : text)
  const doFetch = input.fetch ?? fetch
  let res: Response
  try {
    res = await doFetch(input.url, {
      method: 'POST',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'content-type': 'application/json',
      },
      body: JSON.stringify(input.payload),
    })
  } catch (error) {
    throw new ReportError({
      kind: 'unreachable',
      endpoint,
      detail: redact(String((error as Error)?.message)),
    })
  }
  const body = (await res.json().catch(() => ({}))) as { message?: unknown; created?: unknown }
  if (!res.ok) {
    const message = typeof body.message === 'string' && body.message ? body.message : res.statusText
    throw new ReportError({ kind: 'rejected', endpoint, status: res.status, detail: redact(message) })
  }
  return typeof body.created === 'boolean'
    ? { status: res.status, created: body.created }
    : { status: res.status }
}
