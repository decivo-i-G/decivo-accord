import { type DriftReport, healthScore } from '@decivo/accord-cli'
import type { ItemOrigin, SurfaceHealth, SurfaceId } from './data'
import type { ProposalView } from './proposals'

export type Severity = 'high' | 'medium' | 'low'
export type SurfaceKey = SurfaceId

/** A text as a message key plus parameters, rendered per language. `ns` names another message namespace. */
export interface Text {
  key: string
  values: Record<string, string | number>
  ns?: 'proposals' | undefined
}

/** The one thing to do about a finding. */
export type FindingAction =
  | { kind: 'proposal'; id: string }
  | { kind: 'command'; command: string }
  | { kind: 'link'; to: 'register' | 'connections' }
  /** A file to edit in the repository (its path is copied), e.g. the code patterns in the config. */
  | { kind: 'file'; path: string }

/** One entry of "Fix next": what is wrong, how much it touches, and the one action that resolves it. */
export interface Finding {
  id: string
  severity: Severity
  surface: SurfaceKey
  cause:
    | 'proposal'
    | 'drift'
    | 'deleted'
    | 'conflict'
    | 'surfaceChange'
    | 'behind'
    /** Overview only: a surface's deleted and outdated tokens as one item ("2 Werte in Figma zurückstellen"). */
    | 'revert'
    | 'firstSync'
    | 'hardValues'
    | 'unmapped'
    | 'missing'
    | 'literals'
    | 'unreadable'
    | 'noFiles'
    | 'follow'
  /** How many places it touches (token uses, values, changes); ranks findings of the same severity. */
  impact: number
  title: Text
  text: Text
  action: FindingAction
  /** The register tokens it is about, when it names them (deleted in Figma, missing in code, ...). */
  tokens?: string[] | undefined
}

export type ProposalLike = Pick<
  ProposalView,
  | 'id'
  | 'kind'
  | 'tool'
  | 'group'
  | 'risk'
  | 'changes'
  | 'colors'
  | 'title'
  | 'summary'
  | 'createdAt'
  | 'decision'
>

export interface FindingsInput {
  report: DriftReport
  surfaces: Partial<Record<SurfaceId, SurfaceHealth>>
  proposals: readonly ProposalLike[]
}

/** Where the register's configuration usually lives, when the project does not say. */
const CONFIG_FILE = '.accord/accord.config.yaml'

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 }

/** The command that turns what a tool changed into a proposal (the web cannot read the tool by itself). */
export const proposeCommand = (surface: 'figma' | 'pen') => `accord ${surface} propose --write`

export const examples = (list: readonly string[], max = 3) =>
  list.length > max ? `${list.slice(0, max).join(', ')} +${list.length - max}` : list.join(', ')

/** Counts of differences by where they come from. */
export function originCounts(items: readonly { origin: ItemOrigin }[]): Record<ItemOrigin, number> {
  const out: Record<ItemOrigin, number> = { tool: 0, register: 0, both: 0, deleted: 0, unknown: 0 }
  for (const i of items) out[i.origin]++
  return out
}

/** Open proposals of one surface, in inbox order. */
export const openProposals = (proposals: readonly ProposalLike[], surface: SurfaceId) =>
  proposals.filter((p) => p.tool === surface && p.group !== 'decided')

function proposalFindings(proposals: readonly ProposalLike[]): Finding[] {
  const out: Finding[] = []
  for (const p of proposals) {
    // Hard values in code are listed per file below; decided proposals are done.
    if (p.group === 'decided' || p.kind === 'code') continue
    const risky = p.risk.deletion || p.risk.breaking || p.risk.conflict
    out.push({
      id: `proposal:${p.id}`,
      severity: p.group === 'needsYou' ? (risky ? 'high' : 'medium') : 'low',
      surface: p.tool,
      cause: 'proposal',
      impact: Math.max(1, p.changes.length + p.colors.filter((c) => c.match !== 'exact').length),
      title: { key: p.title.key, values: p.title.values ?? {}, ns: 'proposals' },
      text: { key: p.summary.key, values: p.summary.values ?? {}, ns: 'proposals' },
      action: { kind: 'proposal', id: p.id },
    })
  }
  return out
}

/** Differences of Figma or Pencil that no open proposal covers yet, grouped by where they come from. */
function surfaceFindings(surface: SurfaceHealth, proposals: readonly ProposalLike[]): Finding[] {
  if (surface.id !== 'figma' && surface.id !== 'pen') return []
  const id = surface.id
  const covered = new Set(openProposals(proposals, id).flatMap((p) => p.changes.map((c) => c.token)))
  const items = surface.items.filter((i) => !covered.has(i.token))
  const out: Finding[] = []
  const group = (
    origin: ItemOrigin,
    cause: Finding['cause'],
    severity: Severity,
    command: string,
  ): Finding | undefined => {
    const list = items.filter((i) => i.origin === origin)
    if (list.length === 0) return undefined
    return {
      id: `${id}:${origin}`,
      severity,
      surface: id,
      cause,
      impact: list.length,
      title: { key: `finding.${cause}Title`, values: { count: list.length, tool: id } },
      text: {
        key: `finding.${cause}Text`,
        values: { count: list.length, tokens: examples(list.map((i) => i.token)), tool: id },
      },
      action: { kind: 'command', command },
      tokens: list.map((i) => i.token),
    }
  }
  const propose = proposeCommand(id)
  for (const f of [
    group('deleted', 'deleted', 'high', propose),
    group('both', 'conflict', 'high', propose),
    group('tool', 'surfaceChange', 'medium', propose),
    group('unknown', 'firstSync', 'medium', propose),
    group('register', 'behind', 'low', `accord ${id} status`),
  ])
    if (f) out.push(f)

  if (surface.errors.length > 0)
    out.push({
      id: `${id}:unreadable`,
      severity: 'medium',
      surface: id,
      cause: 'unreadable',
      impact: surface.errors.length,
      title: { key: 'finding.unreadableTitle', values: { count: surface.errors.length, tool: id } },
      text: { key: 'finding.unreadableText', values: { error: surface.errors[0] ?? '' } },
      action: { kind: 'command', command: `accord ${id} status` },
    })
  if (surface.unmapped.length > 0)
    out.push({
      id: `${id}:unmapped`,
      severity: 'low',
      surface: id,
      cause: 'unmapped',
      impact: surface.unmapped.length,
      title: { key: 'finding.toolUnmappedTitle', values: { count: surface.unmapped.length, tool: id } },
      text: { key: 'finding.toolUnmappedText', values: { examples: examples(surface.unmapped) } },
      action: { kind: 'command', command: propose },
    })
  if (surface.literals > 0)
    out.push({
      id: `${id}:literals`,
      severity: 'low',
      surface: id,
      cause: 'literals',
      impact: surface.literals,
      title: { key: 'finding.literalsTitle', values: { count: surface.literals } },
      text: { key: 'finding.literalsText', values: {} },
      action: { kind: 'command', command: `accord ${id} status` },
    })
  return out
}

function codeFindings(
  report: DriftReport,
  proposals: readonly ProposalLike[],
  config: SurfaceHealth['config'],
): Finding[] {
  const out: Finding[] = []
  const usage = report.code.tokenUsage ?? {}
  const waiting = awaitingCode(report, proposals)
  for (const d of report.code.drift) {
    const path = d.path.replace(/^tokens\./, '')
    const follow = waiting.get(path)
    if (follow) {
      // Decided here, code still has the old value: a calm follow-up, not a deviation.
      out.push({
        id: `follow:${d.path}`,
        severity: 'low',
        surface: 'code',
        cause: 'follow',
        impact: Math.max(1, usage[path] ?? 0),
        title: { key: 'finding.followTitle', values: { path } },
        text: { key: 'finding.followText', values: { register: follow.register, code: follow.code } },
        action: { kind: 'command', command: 'accord diff' },
      })
      continue
    }
    out.push({
      id: `drift:${d.path}`,
      severity: d.breaking ? 'high' : 'medium',
      surface: 'code',
      cause: 'drift',
      impact: Math.max(1, usage[path] ?? 0),
      title: { key: 'finding.driftTitle', values: { path } },
      text: {
        key: d.register !== undefined ? 'finding.driftValues' : 'finding.driftOther',
        values: { register: d.register ?? '', code: d.surface ?? '', reason: d.reason },
      },
      action: { kind: 'command', command: 'accord diff' },
    })
  }

  if (report.code.filesScanned === 0)
    out.push({
      id: 'code:nofiles',
      severity: 'medium',
      surface: 'code',
      cause: 'noFiles',
      impact: 1,
      title: { key: 'finding.noFilesTitle', values: {} },
      text: {
        key: 'finding.noFilesText',
        values: { patterns: (config?.include ?? []).join(', '), file: config?.file ?? CONFIG_FILE },
      },
      // The fix is an edit of the patterns, not a command: `accord diff` only checks it afterwards.
      action: { kind: 'file', path: config?.file ?? CONFIG_FILE },
    })

  const derived = new Set(proposals.filter((p) => p.kind === 'code').map((p) => p.id))
  const byFile = new Map<string, DriftReport['code']['hardValues']>()
  for (const h of report.code.hardValues) byFile.set(h.file, [...(byFile.get(h.file) ?? []), h])
  for (const [file, values] of byFile) {
    const replacements = [...new Set(values.map((v) => v.replacement).filter((r): r is string => Boolean(r)))]
    const proposal = `code:${file}`
    out.push({
      id: `hard:${file}`,
      severity: 'medium',
      surface: 'code',
      cause: 'hardValues',
      impact: values.length,
      title: { key: 'finding.hardTitle', values: { count: values.length, file } },
      text: {
        key: replacements.length > 0 ? 'finding.hardWithReplacement' : 'finding.hardNoToken',
        values: {
          exact: values.filter((v) => v.replacement).length,
          near: values.filter((v) => !v.replacement && v.near).length,
          replacements: replacements.slice(0, 3).join(', '),
        },
      },
      action: derived.has(proposal)
        ? { kind: 'proposal', id: proposal }
        : { kind: 'command', command: `accord check ${file}` },
    })
  }

  if (report.code.unmapped.length > 0)
    out.push({
      id: 'unmapped',
      severity: 'low',
      surface: 'code',
      cause: 'unmapped',
      impact: report.code.unmapped.length,
      title: { key: 'finding.unmappedTitle', values: { count: report.code.unmapped.length } },
      text: {
        key: 'finding.unmappedText',
        values: { examples: examples(report.code.unmapped.map((u) => u.name)) },
      },
      action: { kind: 'command', command: 'accord diff' },
    })
  if (report.code.missing.length > 0)
    out.push({
      id: 'missing',
      severity: 'low',
      surface: 'code',
      cause: 'missing',
      impact: report.code.missing.length,
      title: { key: 'finding.missingTitle', values: { count: report.code.missing.length } },
      text: {
        key: 'finding.missingText',
        // The stylesheet the variables go into, when the config names one.
        values: { examples: examples(report.code.missing), file: config?.css?.[0] ?? 'none' },
      },
      action: { kind: 'link', to: 'register' },
      tokens: [...report.code.missing],
    })
  return out
}

/**
 * "Fix next": everything that keeps a surface from matching the register, ranked by severity and then by
 * impact (how many places it touches). Open proposals come first within their severity when the impact is
 * equal, because a decision is the fastest way to move. Each finding carries exactly one action.
 */
export function buildFindings(input: FindingsInput): Finding[] {
  const all = [
    ...proposalFindings(input.proposals),
    ...(['figma', 'pen'] as const).flatMap((s) => {
      const surface = input.surfaces[s]
      return surface ? surfaceFindings(surface, input.proposals) : []
    }),
    ...codeFindings(input.report, input.proposals, input.surfaces.code?.config),
  ]
  // Array.prototype.sort is stable: equal findings keep the order above (proposals, tools, code).
  return all.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.impact - a.impact)
}

/** How many points each part of the (preliminary) score costs, i.e. how much fixing it can still bring. */
export function scoreBreakdown(parts: { tokenSync: number; hardValues: number }) {
  const { tokenSync, hardValues } = parts
  return {
    tokenSync: { share: tokenSync, lost: Math.round(50 * (1 - tokenSync)) },
    hardValues: { share: hardValues, lost: Math.round(50 * (1 - hardValues)) },
  }
}

export type Band = 'good' | 'fair' | 'poor' | 'bad'

/** A word for the score, so it never depends on a colour alone. */
export const bandOf = (score: number): Band =>
  score >= 90 ? 'good' : score >= 70 ? 'fair' : score >= 50 ? 'poor' : 'bad'

const sameValue = (a: string | undefined, b: string | undefined) =>
  a !== undefined && b !== undefined && a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Code drift that only waits for code to follow a decision: an adopted proposal set the register to the
 * value it has now, and code still has exactly the value from before. Keyed by token path (no `tokens.`).
 */
export function awaitingCode(
  report: DriftReport,
  proposals: readonly ProposalLike[],
): Map<string, { proposal: string; register: string; code: string }> {
  const out = new Map<string, { proposal: string; register: string; code: string }>()
  const adopted = proposals.filter((p) => p.group === 'decided' && p.decision?.option === 'adopt')
  for (const d of report.code.drift) {
    if (d.kind !== 'token.value_changed') continue
    const path = d.path.replace(/^tokens\./, '')
    for (const p of adopted) {
      const c = p.changes.find((x) => x.kind === 'change' && x.token === path)
      if (c && sameValue(c.after, d.register) && sameValue(c.before, d.surface))
        out.set(path, { proposal: p.id, register: d.register ?? '', code: d.surface ?? '' })
    }
  }
  return out
}

/** The score as Health, Home and the sidebar show it. */
export interface HealthSummary {
  /** False when no code file was scanned: then there is no meaningful score, only "not measurable yet". */
  measurable: boolean
  score: number
  band: Band
  /** Tokens that wait for code to follow a decision; they do not cost points (deciding is never punished). */
  waiting: number
  inSync: number
  covered: number
  hardColours: number
  files: number
  parts: ReturnType<typeof scoreBreakdown>
}

/**
 * Accord's preliminary score (the CLI's own `healthScore`), with one difference to `accord diff`: a token that
 * code has not caught up with since a decision taken here counts as in sync until code is changed.
 */
export function healthSummary(report: DriftReport, proposals: readonly ProposalLike[]): HealthSummary {
  const { code } = report
  const waiting = awaitingCode(report, proposals).size
  const hardColours = code.hardValues.filter((h) => h.kind === 'color').length
  const inSync = Math.min(code.tokensCovered, code.tokensInSync + waiting)
  const { score, parts } = healthScore(inSync, code.tokensCovered, hardColours, code.filesScanned)
  return {
    measurable: code.filesScanned > 0,
    score,
    band: bandOf(score),
    waiting,
    inSync: code.tokensInSync,
    covered: code.tokensCovered,
    hardColours,
    files: code.filesScanned,
    parts: scoreBreakdown(parts),
  }
}

/** The one next step for a surface card. */
export type NextAction =
  | { kind: 'proposals'; id: string; count: number }
  | {
      kind: 'command'
      reason: 'propose' | 'behind' | 'unreadable' | 'drift' | 'follow' | 'hardValues' | 'noFiles'
      command: string
    }
  | { kind: 'setup'; command: string }
  | { kind: 'done' }

/**
 * What to do next on one surface: decide its open proposals; else the exact CLI command when the web cannot
 * do it (read the tool, propose, re-check); else nothing. A surface without files gets its setup command.
 */
export function nextAction(
  surface: SurfaceHealth,
  proposals: readonly ProposalLike[],
  report?: DriftReport | undefined,
): NextAction {
  const open = openProposals(proposals, surface.id)
  if (surface.id === 'claude-design') {
    const all = proposals.filter((p) => p.tool === 'claude-design')
    if (open[0]) return { kind: 'proposals', id: open[0].id, count: open.length }
    return all.length === 0 ? { kind: 'setup', command: 'accord ingest <handoff.zip>' } : { kind: 'done' }
  }
  if (surface.id === 'code') {
    if (open[0]) return { kind: 'proposals', id: open[0].id, count: open.length }
    if (surface.items.length > 0) {
      const waiting = report ? awaitingCode(report, proposals) : new Map()
      const onlyWaiting = surface.items.every((i) => waiting.has(i.token))
      return { kind: 'command', reason: onlyWaiting ? 'follow' : 'drift', command: 'accord diff' }
    }
    if (report?.code.filesScanned === 0) return { kind: 'command', reason: 'noFiles', command: 'accord diff' }
    if ((report?.code.hardValueSummary.total ?? 0) > 0)
      return { kind: 'command', reason: 'hardValues', command: 'accord diff' }
    return { kind: 'done' }
  }
  const id = surface.id
  if (surface.files.length === 0)
    return surface.errors.length > 0
      ? { kind: 'command', reason: 'unreadable', command: `accord ${id} status` }
      : { kind: 'setup', command: `accord ${id} status` }
  if (open[0]) return { kind: 'proposals', id: open[0].id, count: open.length }
  if (surface.errors.length > 0)
    return { kind: 'command', reason: 'unreadable', command: `accord ${id} status` }
  const pending = surface.items.filter((i) => i.origin !== 'register')
  if (pending.length > 0 || surface.unmapped.length > 0)
    return { kind: 'command', reason: 'propose', command: proposeCommand(id) }
  if (surface.items.length > 0) return { kind: 'command', reason: 'behind', command: `accord ${id} status` }
  return { kind: 'done' }
}

/**
 * How many points of the (preliminary) score each finding can still bring, with the CLI's own formula:
 * fixing the hard-coded colours of one file, or bringing one drifting token in line. Decisions, follow-ups
 * and the tools' own drift do not move the score (it is measured on code), so they bring none.
 */
export function findingPoints(
  findings: readonly Finding[],
  report: DriftReport,
  proposals: readonly ProposalLike[],
): Map<string, number> {
  const out = new Map<string, number>()
  const { code } = report
  if (code.filesScanned === 0) return out
  const waiting = awaitingCode(report, proposals).size
  const inSync = Math.min(code.tokensCovered, code.tokensInSync + waiting)
  const colours = code.hardValues.filter((h) => h.kind === 'color')
  const score = (sync: number, hard: number) =>
    healthScore(sync, code.tokensCovered, hard, code.filesScanned).score
  const now = score(inSync, colours.length)
  for (const f of findings) {
    let gain = 0
    if (f.cause === 'hardValues') {
      const file = f.id.slice('hard:'.length)
      const k = colours.filter((h) => h.file === file).length
      gain = k > 0 ? score(inSync, colours.length - k) - now : 0
    } else if (f.cause === 'drift') {
      gain = score(Math.min(code.tokensCovered, inSync + 1), colours.length) - now
    }
    if (gain > 0) out.set(f.id, gain)
  }
  return out
}

/** What one surface's sync line and counts say, with the open proposals of that tool taken into account. */
export interface SurfaceDrift {
  compared: number
  inSync: number
  counts: Record<ItemOrigin, number>
}

/**
 * Figma and Pencil: a token with an open proposal from the tool is not in sync until it is decided, even
 * when the tool's file was changed back since. So the sync line counts the same differences that created
 * the proposals ("6 of 9 in sync", "changed 2", "deleted 1"), and never contradicts the inbox.
 */
export function surfaceDrift(surface: SurfaceHealth, proposals: readonly ProposalLike[]): SurfaceDrift {
  if ((surface.id !== 'figma' && surface.id !== 'pen') || !surface.tokens)
    return { compared: surface.compared, inSync: surface.inSync, counts: originCounts(surface.items) }
  const origin = new Map<string, ItemOrigin>(surface.items.map((i) => [i.token, i.origin]))
  for (const p of openProposals(proposals, surface.id))
    for (const c of p.changes) {
      if (c.kind === 'new' || origin.has(c.token)) continue
      origin.set(c.token, c.kind === 'remove' ? 'deleted' : c.origin === 'conflict' ? 'both' : 'tool')
    }
  const compared = new Set(surface.tokens)
  for (const [token, o] of origin) if (o === 'deleted') compared.add(token)
  const inSync = [...compared].filter((token) => !origin.has(token)).length
  return {
    compared: compared.size,
    inSync,
    counts: originCounts([...origin.values()].map((o) => ({ origin: o }))),
  }
}
