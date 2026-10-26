import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type Evaluation, evaluate, type LiteralUse } from '@decivo/accord-checks'
import {
  type ColorValue,
  colorToCss,
  cssToColor,
  cssToDimension,
  type DimensionValue,
  type Owner,
  type Register,
} from '@decivo/accord-core'
import { loadRegister } from '@decivo/accord-core/node'
import { cache } from 'react'
import { z } from 'zod'
import { getHealth } from './data'
import { findProject, type Project, registerDirOf } from './projects'

/** A text for the interface: a key under `proposals.` plus its values, rendered per language. */
export type Message = { key: string; values?: Record<string, string | number> }

/** Where a proposal comes from. Pencil files are `.pen`, so the tool is called `pen` in code. */
export type Tool = 'figma' | 'pen' | 'claude-design' | 'code'

/**
 * The inbox groups: a person decides here, safe to adopt with one click, fixed in code (not decided
 * here), already decided.
 */
export type InboxGroup = 'needsYou' | 'auto' | 'code' | 'decided'

export type Option = 'adopt' | 'reset' | 'reject'

/** One token a design tool changed, added or deleted. */
export interface ChangeView {
  token: string
  kind: 'change' | 'new' | 'remove'
  /** Token type (`color`, `dimension`, …); `unknown` when the file does not say. */
  type: string
  before?: string | undefined
  after?: string | undefined
  owner: Owner
  origin: 'surface' | 'conflict' | 'unknown'
  /** Name of the variable in the tool, for new ones. */
  variable?: string | undefined
}

/** A colour of a Claude Design handoff and how it maps onto the register. */
export interface DraftColorView {
  value: string
  count: number
  match: 'exact' | 'near' | 'new'
  /** Register token it matches (exact) or is close to (near). */
  token?: string | undefined
  /** CSS value of that token, for the swatch. */
  tokenValue?: string | undefined
  /** Near misses: CIEDE2000 distance to that token (below ~2.3 is barely visible). */
  distance?: number | undefined
}

/** A rule the proposal breaks, with its reason. */
export interface RuleView {
  decision: string
  level: string
  rule: string
  why: string
  value: string
  nearest?: string | undefined
  count: number
}

export interface DecisionView {
  option: Option
  by?: string | undefined
  at?: string | undefined
  note?: string | undefined
}

/** What the inbox shows for one proposal. */
export interface ProposalView {
  id: string
  kind: 'surface' | 'handoff' | 'code'
  tool: Tool
  createdAt?: string | undefined
  route: Evaluation['route']
  decider?: Owner | undefined
  group: InboxGroup
  title: Message
  /** One line: what changed. */
  summary: Message
  /** Who decides and why, as one sentence. */
  why: Message
  changes: ChangeView[]
  /** Handoffs only: the draft's colours, near misses and new ones first. */
  colors: DraftColorView[]
  handoff?: { name: string; pages: number } | undefined
  rules: RuleView[]
  risk: { deletion: boolean; breaking: boolean; conflict: boolean }
  decision?: DecisionView | undefined
  /** Stored proposals are decided here; derived ones (hard values in code) are fixed in code. */
  decidable: boolean
  /** Hard values in code: the file and the tokens that replace them. */
  code?: { file: string; count: number; replacements: string[] } | undefined
}

// --- Reading stored proposals -------------------------------------------------------------------
// Proposal files are written by the CLI (`accord figma|pen propose --write`, `accord handoff`), possibly
// by an older or newer version. They are data: anything that does not fit is skipped, never trusted.

const owner = z.enum(['design', 'code', 'register'])
const route = z.enum(['auto', 'reset', 'explain', 'owner'])

const ChangeSchema = z.object({
  token: z.string().min(1),
  kind: z.enum(['change', 'new', 'remove']),
  type: z.string().catch('unknown').default('unknown'),
  before: z.string().optional().catch(undefined),
  after: z.string().optional().catch(undefined),
  origin: z.enum(['surface', 'conflict', 'unknown']).catch('surface').default('surface'),
  // A change whose owner is unknown goes to the register, the strictest owner.
  owner: owner.catch('register').default('register'),
  variable: z.string().optional().catch(undefined),
})

const ViolationSchema = z.object({
  decision: z.string().min(1),
  level: z.string().catch('must').default('must'),
  rule: z.string().catch('').default(''),
  why: z.string().catch('').default(''),
  value: z.coerce.string().catch('').default(''),
  nearest: z.string().optional().catch(undefined),
  count: z.number().catch(1).default(1),
})

const DraftColorSchema = z.object({
  value: z.string().min(1),
  count: z.number().catch(1).default(1),
  exact: z.array(z.string()).catch([]).default([]),
  near: z.object({ path: z.string(), distance: z.number() }).optional().catch(undefined),
})

const ResolutionRecordSchema = z.object({
  option: z.enum(['adopt', 'reset', 'reject']),
  by: z.string().optional().catch(undefined),
  at: z.string().optional().catch(undefined),
  note: z.string().optional().catch(undefined),
})

/** Keep the elements of a list that fit `schema`; anything else is dropped. */
const lenientList = <T extends z.ZodType>(schema: T) =>
  z
    .array(z.unknown())
    .catch([])
    .default([])
    .transform((list) =>
      list.flatMap((entry) => {
        const parsed = schema.safeParse(entry)
        return parsed.success ? [parsed.data as z.output<T>] : []
      }),
    )

const BaseSchema = z.object({
  id: z.string().regex(/^P-[A-Za-z0-9-]+$/),
  createdAt: z.string().optional().catch(undefined),
  // An unknown route goes to a person: never let an unreadable file pass on its own.
  route: route.catch('owner').default('owner'),
  decider: owner.optional().catch(undefined),
  reasons: lenientList(z.object({ code: z.string(), at: z.string().optional().catch(undefined) })),
  violations: lenientList(ViolationSchema),
  resolution: ResolutionRecordSchema.optional().catch(undefined),
  /** Older web app versions recorded `accepted`/`rejected` here instead of a resolution. */
  status: z.string().optional().catch(undefined),
})

const SurfaceSchema = BaseSchema.extend({
  source: z.enum(['figma', 'pen']),
  changes: lenientList(ChangeSchema),
})

const HandoffSchema = BaseSchema.extend({
  source: z.literal('claude-design'),
  bundle: z
    .object({ name: z.string().catch('handoff'), pages: z.array(z.unknown()).catch([]).default([]) })
    .catch({ name: 'handoff', pages: [] }),
  colors: z
    .object({
      inRegister: lenientList(DraftColorSchema),
      nearMisses: lenientList(DraftColorSchema),
      new: lenientList(DraftColorSchema),
    })
    .catch({ inRegister: [], nearMisses: [], new: [] }),
})

export type StoredSurface = z.output<typeof SurfaceSchema>
export type StoredHandoff = z.output<typeof HandoffSchema>
export type StoredProposal = StoredSurface | StoredHandoff

/** Read one proposal file's content. Undefined when it is neither a Figma/Pencil nor a handoff proposal. */
export function parseStoredProposal(raw: unknown): StoredProposal | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const source = (raw as { source?: unknown }).source
  const parsed =
    source === 'claude-design'
      ? HandoffSchema.safeParse(raw)
      : source === 'figma' || source === 'pen'
        ? SurfaceSchema.safeParse(raw)
        : undefined
  return parsed?.success ? parsed.data : undefined
}

const proposalsDir = (project: Project) => join(registerDirOf(project), 'proposals')

/** Stored proposals of a project, newest file first, plus the files that could not be read. */
export async function readStoredProposals(
  project: Project,
): Promise<{ proposals: { file: string; raw: unknown; data: StoredProposal }[]; unreadable: string[] }> {
  const dir = proposalsDir(project)
  const names = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.json'))
  const proposals: { file: string; raw: unknown; data: StoredProposal }[] = []
  const unreadable: string[] = []
  for (const name of names.sort().reverse()) {
    const file = join(dir, name)
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(file, 'utf8'))
    } catch {
      unreadable.push(name)
      continue
    }
    const data = parseStoredProposal(raw)
    if (data) proposals.push({ file, raw, data })
    else unreadable.push(name)
  }
  return { proposals, unreadable }
}

/** A stored proposal by id (for decisions). */
export async function findStoredProposal(
  project: Project,
  id: string,
): Promise<{ file: string; raw: unknown; data: StoredProposal } | undefined> {
  return (await readStoredProposals(project)).proposals.find((p) => p.data.id === id)
}

// --- Views --------------------------------------------------------------------------------------

function decisionOf(stored: StoredProposal): DecisionView | undefined {
  if (stored.resolution) return stored.resolution
  if (stored.status === 'accepted') return { option: 'adopt' }
  if (stored.status === 'rejected') return { option: 'reject' }
  return undefined
}

function groupOf(r: Evaluation['route'], decision: DecisionView | undefined): InboxGroup {
  if (decision) return 'decided'
  return r === 'auto' || r === 'reset' ? 'auto' : 'needsYou'
}

/** ICU select keys cannot contain hyphens: `claude-design` is `claude` in messages. */
export const selectArg = (tool: Tool) => (tool === 'claude-design' ? 'claude' : tool)

const plural = (list: string[], max = 3) =>
  list.length > max ? `${list.slice(0, max).join(', ')} +${list.length - max}` : list.join(', ')

/** The sentence that says who decides and why, from the strongest route reason. */
function whyOf(
  reasons: { code: string; at?: string | undefined }[],
  ctx: {
    tool: Tool
    decider?: Owner | undefined
    rules: RuleView[]
    changes: ChangeView[]
    /** Handoffs: how many colours of the draft are new. */
    fresh?: number | undefined
    /** Handoffs: how many of the new ones are only a transparency (`#00000014`), not a new shade. */
    alpha?: number | undefined
  },
): Message {
  const first = reasons[0]?.code ?? 'default'
  const rule = ctx.rules.find((r) => r.level === 'must') ?? ctx.rules[0]
  const at = reasons[0]?.at?.replace(/^tokens\./, '') ?? ctx.changes[0]?.token ?? ''
  const changeOwner = ctx.changes.find((c) => `tokens.${c.token}` === reasons[0]?.at)?.owner
  const values = {
    who: ctx.decider ?? 'other',
    owner: changeOwner ?? ctx.decider ?? 'other',
    tool: selectArg(ctx.tool),
    decision: rule?.decision ?? '',
    rule: rule?.rule || rule?.decision || '',
    value: rule?.value ?? '',
    count: ctx.fresh ?? 0,
    shades: (ctx.fresh ?? 0) - (ctx.alpha ?? 0),
    alpha: ctx.alpha ?? 0,
    at,
  }
  const deletion = reasons.some((r) => r.code === 'deletion')
  if (first === 'breaking' && deletion) return { key: 'why.deletion', values }
  const known = [
    'breaking',
    'deletion',
    'conflict',
    'must_violation',
    'not_owner',
    'register_owned',
    'drift_addition',
    'should_violation',
    'low_confidence',
    'unanswered',
    'drift_reset',
    'safe',
    'nothing_to_do',
  ]
  if (first === 'must_violation' && !rule) return { key: 'why.default', values }
  // A colour that is not in the register leads with the fact: "#2a5d7c is a new shade."
  if (first === 'must_violation' && ctx.fresh !== undefined && ctx.fresh > 0)
    return { key: ctx.alpha ? 'why.newShadesSplit' : 'why.newShades', values }
  if (first === 'must_violation' && ctx.changes[0]?.type === 'color' && rule?.value.startsWith('#'))
    return { key: 'why.newShade', values }
  return { key: known.includes(first) ? `why.${first}` : 'why.default', values }
}

function surfaceView(stored: StoredSurface): ProposalView {
  const changes: ChangeView[] = stored.changes
  const rules: RuleView[] = stored.violations
  const decision = decisionOf(stored)
  const [only] = changes
  const title: Message =
    changes.length === 1 && only
      ? { key: `title.${only.kind}`, values: { token: only.token, tool: stored.source } }
      : { key: 'title.many', values: { count: changes.length, tool: stored.source } }
  const summary: Message =
    changes.length === 1 && only
      ? { key: `summary.${only.kind}`, values: { before: only.before ?? '', after: only.after ?? '' } }
      : { key: 'summary.many', values: { tokens: plural(changes.map((c) => c.token)) } }
  const reasons = stored.reasons.length > 0 ? stored.reasons : [{ code: 'default' }]
  return {
    id: stored.id,
    kind: 'surface',
    tool: stored.source,
    createdAt: stored.createdAt,
    route: stored.route,
    decider: stored.decider,
    group: groupOf(stored.route, decision),
    title,
    summary,
    why: whyOf(reasons, { tool: stored.source, decider: stored.decider, rules, changes }),
    changes,
    colors: [],
    rules,
    risk: {
      deletion: changes.some((c) => c.kind === 'remove') || reasons.some((r) => r.code === 'deletion'),
      breaking: reasons.some((r) => r.code === 'breaking'),
      conflict: changes.some((c) => c.origin !== 'surface') || reasons.some((r) => r.code === 'conflict'),
    },
    decision,
    decidable: true,
  }
}

function tokenCss(register: Register, path: string | undefined): string | undefined {
  const token = path ? register.tokens.get(path) : undefined
  return token?.type === 'color' && token.value ? colorToCss(token.value as ColorValue) : undefined
}

function handoffView(stored: StoredHandoff, register: Register): ProposalView {
  const { colors } = stored
  const rules: RuleView[] = stored.violations
  const decision = decisionOf(stored)
  const draft = (match: DraftColorView['match'], list: typeof colors.new): DraftColorView[] =>
    [...list]
      .sort((a, b) => b.count - a.count)
      .map((c) => {
        const token = match === 'near' ? (c.near?.path ?? c.exact[0]) : c.exact[0]
        return {
          value: c.value,
          count: c.count,
          match,
          token,
          tokenValue: tokenCss(register, token),
          distance: match === 'near' ? c.near?.distance : undefined,
        }
      })
  const must = rules.find((r) => r.level === 'must')
  // Handoff files keep no route reasons; the rules they break are the reason.
  const reasons = must
    ? [{ code: 'must_violation' }]
    : rules.length > 0
      ? [{ code: 'should_violation' }]
      : [{ code: stored.route === 'auto' ? 'safe' : 'default' }]
  return {
    id: stored.id,
    kind: 'handoff',
    tool: 'claude-design',
    createdAt: stored.createdAt,
    route: stored.route,
    decider: stored.decider,
    group: groupOf(stored.route, decision),
    title: { key: 'title.handoff', values: { name: stored.bundle.name } },
    // Zero counts are left out: "0 from the register" reads like a failure.
    summary: {
      key:
        colors.new.length > 0 && colors.nearMisses.length > 0
          ? 'summary.handoffBoth'
          : colors.new.length > 0
            ? 'summary.handoffNew'
            : colors.nearMisses.length > 0
              ? 'summary.handoffNear'
              : 'summary.handoffRegister',
      values: { near: colors.nearMisses.length, fresh: colors.new.length },
    },
    why: whyOf(reasons, {
      tool: 'claude-design',
      decider: stored.decider,
      rules,
      changes: [],
      fresh: colors.new.length,
      alpha: colors.new.filter((c) => {
        const a = cssToColor(c.value)?.alpha
        return a !== undefined && a < 1
      }).length,
    }),
    changes: [],
    colors: [
      ...draft('near', colors.nearMisses),
      ...draft('new', colors.new),
      ...draft('exact', colors.inRegister),
    ],
    handoff: { name: stored.bundle.name, pages: stored.bundle.pages.length },
    rules,
    risk: { deletion: false, breaking: false, conflict: false },
    decision,
    decidable: true,
  }
}

/** One proposal per file with hard-coded values: "switch this file to tokens", evaluated by the check layer. */
async function fromHardValues(project: Project, register: Register, limit: number): Promise<ProposalView[]> {
  const { report } = await getHealth(project)
  const byFile = new Map<string, typeof report.code.hardValues>()
  for (const h of report.code.hardValues) byFile.set(h.file, [...(byFile.get(h.file) ?? []), h])
  const files = [...byFile].sort((a, b) => b[1].length - a[1].length).slice(0, limit)
  const out: ProposalView[] = []
  for (const [file, values] of files) {
    const literals: LiteralUse[] = values.map((h) => ({
      file: h.file,
      line: h.line,
      column: h.column,
      raw: h.raw,
      kind: h.kind,
      value: (h.kind === 'color' ? cssToColor(h.raw) : cssToDimension(h.raw)) as ColorValue | DimensionValue,
      replacement: h.replacement,
      near: h.near,
    }))
    const evaluation = await evaluate({
      register,
      change: { source: 'code', intent: 'proposal', items: [], literals },
    })
    const replacements = [...new Set(values.map((v) => v.replacement).filter((r): r is string => Boolean(r)))]
    const grouped = new Map<string, RuleView>()
    for (const v of evaluation.literalViolations) {
      const entry = grouped.get(v.decisionId) ?? {
        decision: v.decisionId,
        level: v.level,
        rule: v.rule,
        why: v.why,
        value: String(v.detail.value ?? ''),
        nearest: v.replacement,
        count: 0,
      }
      entry.count++
      grouped.set(v.decisionId, entry)
    }
    const rules = [...grouped.values()]
    const short = file.split('/').slice(-2).join('/')
    out.push({
      id: `code:${file}`,
      kind: 'code',
      tool: 'code',
      route: evaluation.route,
      decider: evaluation.decider,
      // Hard values are fixed in code (by a developer or an agent), never decided in this inbox.
      group: 'code',
      title: { key: 'title.code', values: { file: short } },
      summary: {
        key: 'summary.code',
        values: { count: values.length, tokens: plural(replacements, 2) || 'none' },
      },
      why: {
        key: 'why.code',
        values: {
          decision: rules[0]?.decision ?? '',
          rule: rules[0]?.rule || rules[0]?.decision || '',
          file: short,
        },
      },
      changes: [],
      colors: [],
      rules,
      risk: { deletion: false, breaking: false, conflict: false },
      decidable: false,
      code: { file, count: values.length, replacements },
    })
  }
  return out
}

const GROUP_ORDER: InboxGroup[] = ['needsYou', 'auto', 'code', 'decided']

/**
 * How much a decision weighs, for the order inside a group: one token first, then several, then
 * deletions, then a handoff with its many colours.
 */
export function effortOf(p: Pick<ProposalView, 'kind' | 'changes' | 'risk'>): number {
  if (p.kind === 'handoff') return 3
  if (p.kind === 'code') return 4
  if (p.risk.deletion) return 2
  return p.changes.length > 1 ? 1 : 0
}

export interface Inbox {
  proposals: ProposalView[]
  /** Proposal files Accord could not read (other format, broken JSON). */
  unreadable: string[]
}

/** All proposals of a project in inbox order: needs you, safe to adopt, fixed in code, decided; newest first. */
export async function loadInbox(project: Project): Promise<Inbox> {
  const register = await loadRegister(registerDirOf(project))
  const { proposals: stored, unreadable } = await readStoredProposals(project)
  const views = stored.map(({ data }) =>
    data.source === 'claude-design' ? handoffView(data, register) : surfaceView(data),
  )
  const derived = await fromHardValues(project, register, 5).catch(() => [] as ProposalView[])
  const time = (p: ProposalView) => (p.decision?.at ?? p.createdAt ?? '').toString()
  // Open decisions go from quick to weighty, so the first one the inbox opens is a quick one.
  const effort = (p: ProposalView) => (p.decision ? 0 : effortOf(p))
  const all = [...views, ...derived].sort(
    (a, b) =>
      GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
      Number(b.decidable) - Number(a.decidable) ||
      effort(a) - effort(b) ||
      time(b).localeCompare(time(a)),
  )
  return { proposals: all, unreadable }
}

/** Proposals in inbox order (see `loadInbox`). */
export async function loadProposals(project: Project): Promise<ProposalView[]> {
  return (await loadInbox(project)).proposals
}

/** The inbox of one project, computed once per request (the shell and the page both need it). */
const loadForRequest = cache((slug: string) => {
  const project = findProject(slug)
  return project ? loadInbox(project) : Promise.resolve<Inbox>({ proposals: [], unreadable: [] })
})

/** Open proposals that can be decided here (not the ones fixed in code). */
export async function openProposalCount(project: Pick<Project, 'slug'>): Promise<number> {
  return (await loadForRequest(project.slug)).proposals.filter((p) => isOpen(p)).length
}

/** How many proposals are in each group: the one source for the sidebar badge, the inbox header and Home. */
export interface InboxCounts {
  /** A person decides (the sidebar badge). */
  needsYou: number
  /** Safe to adopt in one go. */
  auto: number
  /** Hard-coded values, fixed in code. */
  code: number
  decided: number
  /** Open and decided here: needs you plus safe. */
  open: number
}

export function inboxCounts(proposals: readonly Pick<ProposalView, 'group'>[]): InboxCounts {
  const count = (g: InboxGroup) => proposals.filter((p) => p.group === g).length
  const needsYou = count('needsYou')
  const auto = count('auto')
  return { needsYou, auto, code: count('code'), decided: count('decided'), open: needsYou + auto }
}

/** Open and decided here: the inbox's progress ("x of y decided") and inbox zero count these. */
export const isOpen = (p: Pick<ProposalView, 'group'>) => p.group === 'needsYou' || p.group === 'auto'

/** `loadInbox` deduplicated within one request. */
export const loadProjectInbox = (project: Pick<Project, 'slug'>) => loadForRequest(project.slug)

/** `loadProposals` deduplicated within one request. */
export const loadProjectProposals = async (project: Pick<Project, 'slug'>) =>
  (await loadForRequest(project.slug)).proposals

/** What Accord suggests for an open proposal (the one primary button), and why, in one sentence. */
export interface Recommendation {
  option: 'adopt' | 'reset'
  reason: Message
}

/**
 * The suggested decision, derived from the route and the facts the inbox already shows. Every open
 * proposal gets exactly one: the primary button follows it, the other options stay quiet. Where a
 * person has to weigh something up (a deletion, a breaking change, a conflict, a rule) Accord suggests
 * keeping the register as it is, and says who could decide otherwise.
 * `uses`: places in the scanned code that use the tokens a deletion removes (undefined: not scanned).
 */
export function recommendationOf(
  p: ProposalView,
  uses?: number,
  /** The register value of a token, to name the nearest one with its value. */
  tokenValueOf?: (token: string) => string | undefined,
): Recommendation | undefined {
  if (p.decision || !p.decidable) return undefined
  const who = p.decider ?? 'other'
  if (p.kind === 'handoff') {
    const near = p.colors.filter((c) => c.match === 'near').length
    const fresh = p.colors.filter((c) => c.match === 'new').length
    if (near > 0)
      return { option: 'reset', reason: { key: 'recommend.handoffNear', values: { near, fresh } } }
    return {
      option: 'reset',
      reason:
        fresh > 0 ? { key: 'recommend.handoffNew', values: { fresh } } : { key: 'recommend.handoffClean' },
    }
  }
  const first = p.changes[0]
  const at = first?.token ?? ''
  if (p.risk.deletion) {
    const removed = p.changes.filter((c) => c.kind === 'remove')
    const [only] = removed
    const tokens =
      removed.length === 1 && only
        ? only.before
          ? `${only.token} (${only.before})`
          : only.token
        : plural(removed.map((c) => c.token))
    return {
      option: 'reset',
      reason: {
        key: 'recommend.deletion',
        values: {
          tokens,
          count: Math.max(removed.length, 1),
          scanned: uses === undefined ? 'no' : 'yes',
          uses: uses ?? 0,
          who,
        },
      },
    }
  }
  if (p.risk.conflict)
    return {
      option: 'reset',
      reason: { key: 'recommend.conflict', values: { tool: selectArg(p.tool), at, who } },
    }
  if (p.risk.breaking) return { option: 'reset', reason: { key: 'recommend.breaking', values: { who } } }
  const must = p.rules.find((r) => r.level === 'must')
  if (must)
    return must.nearest
      ? {
          option: 'reset',
          reason: {
            key: first?.before && p.changes.length === 1 ? 'recommend.nearest' : 'recommend.nearestNew',
            values: {
              token: at,
              tool: selectArg(p.tool),
              before: first?.before ?? '',
              value: must.value,
              nearest: must.nearest,
              nearestValue: tokenValueOf?.(must.nearest) ?? 'none',
            },
          },
        }
      : {
          option: 'reset',
          reason: { key: 'recommend.rule', values: { value: must.value, rule: must.rule || must.decision } },
        }
  const should = p.rules[0]
  if (should)
    return {
      option: 'reset',
      reason: { key: 'recommend.should', values: { rule: should.rule || should.decision } },
    }
  if (p.route === 'reset')
    return { option: 'reset', reason: { key: 'recommend.drift', values: { tool: selectArg(p.tool), at } } }
  if (p.route === 'auto')
    return {
      option: 'adopt',
      reason: { key: 'recommend.safe', values: { owner: first?.owner ?? who, at } },
    }
  return { option: 'adopt', reason: { key: 'recommend.clean', values: { who } } }
}

/** What each decision button says and what it leads to, in the proposal's own words. */
export interface DecisionCopy {
  label: Record<Option, Message>
  /** One sentence per option: the consequence, shown before the click. */
  effect: Record<Option, Message>
}

/** Values that fit on a button ("#3c6681 behalten"); longer ones (font stacks) use the generic label. */
const SHORT_VALUE = 24
const fits = (value: string | undefined): value is string =>
  value !== undefined && value !== '' && value.length <= SHORT_VALUE

/**
 * Labels that name the outcome ("Keep #3c6681", "Delete spacing.4 …") and one consequence sentence per
 * option. Adopt, reset and reject map to Accord's own resolution options unchanged; only the words
 * follow what each one means for this proposal.
 */
export function decisionCopyOf(
  p: ProposalView,
  /** Tokens that follow a single changed token (its aliases), named in the adopt consequence. */
  aliases: string[] = [],
): DecisionCopy {
  const tool = selectArg(p.tool)
  const reject: Message = { key: 'actions.reject' }
  if (p.kind === 'handoff') {
    const near = p.colors.filter((c) => c.match === 'near').length
    return {
      label: { adopt: { key: 'actions.adopt' }, reset: { key: 'actions.adoptNothing' }, reject },
      effect: {
        adopt: { key: 'effectShort.adoptHandoff' },
        reset: { key: 'effectShort.resetHandoff', values: { near } },
        reject: { key: 'effectShort.rejectHandoff' },
      },
    }
  }
  const rejectEffect: Message = { key: 'effectShort.reject', values: { tool } }
  const removed = p.changes.filter((c) => c.kind === 'remove')
  const [only] = p.changes
  const single = p.changes.length === 1 ? only : undefined
  if (removed.length > 0) {
    const tokens = plural(removed.map((c) => c.token))
    const one = removed.length === 1 && single
    return {
      label: {
        adopt: one
          ? { key: 'actions.deleteToken', values: { token: single.token } }
          : { key: 'actions.adoptRisky' },
        reset: one
          ? { key: 'actions.keepToken', values: { token: single.token } }
          : { key: 'actions.keepRegister' },
        reject,
      },
      effect: {
        adopt:
          removed.length === p.changes.length
            ? { key: 'effectShort.adoptDeletion', values: { tokens } }
            : { key: 'effectShort.adoptWithDeletion', values: { tokens, tool } },
        reset: { key: 'effectShort.keepDeleted', values: { tokens, tool } },
        reject: rejectEffect,
      },
    }
  }
  const risky = p.risk.breaking
  if (single?.kind === 'change') {
    const { token, before, after } = single
    return {
      label: {
        adopt: fits(after)
          ? { key: risky ? 'actions.adoptValueRisky' : 'actions.adoptValue', values: { value: after } }
          : { key: risky ? 'actions.adoptRisky' : 'actions.adopt' },
        reset: fits(before)
          ? { key: 'actions.keepValue', values: { value: before } }
          : { key: 'actions.keepRegisterValue' },
        reject,
      },
      effect: {
        adopt: {
          key: 'effectShort.adopt',
          values: {
            token,
            after: after ?? '',
            aliases: aliases.length > 0 ? plural(aliases.slice(0, 2)) : 'none',
          },
        },
        reset: { key: 'effectShort.reset', values: { token, before: before ?? '', tool } },
        reject: rejectEffect,
      },
    }
  }
  if (single?.kind === 'new')
    return {
      label: {
        adopt: { key: 'actions.addToken', values: { token: single.token } },
        reset: { key: 'actions.leaveOut' },
        reject,
      },
      effect: {
        adopt: { key: 'effectShort.adoptNew', values: { token: single.token, after: single.after ?? '' } },
        reset: { key: 'effectShort.leaveOut', values: { token: single.token, tool } },
        reject: rejectEffect,
      },
    }
  return {
    label: {
      adopt: { key: risky ? 'actions.adoptRisky' : 'actions.adopt' },
      reset: { key: 'actions.keepRegister' },
      reject,
    },
    effect: {
      adopt: { key: 'effectShort.adoptMany', values: { count: p.changes.length } },
      reset: { key: 'effectShort.resetMany', values: { tool } },
      reject: rejectEffect,
    },
  }
}
