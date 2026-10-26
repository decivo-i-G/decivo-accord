import type { DriftReport } from '@decivo/accord-cli'
import type { SurfaceHealth, SurfaceId } from './data'
import { buildFindings, examples, type Finding, nextAction, type ProposalLike } from './findings'
import { type SurfaceStateId, surfaceState } from './surface-state'

/**
 * The project overview (Überblick) as plain data: one sentence about the state, the one next step,
 * at most three short items and one line per surface. Home uses the same sentence and step per
 * project, so both screens always say the same thing. The decisions themselves stay in the inbox:
 * nothing here repeats its list, it only counts and links to it.
 */

/** How many short items the overview shows under its next step. */
export const OVERVIEW_ITEMS = 3

export const SURFACE_ORDER: readonly SurfaceId[] = ['code', 'figma', 'pen', 'claude-design']

type Proposal = ProposalLike

/**
 * The sentence at the top, as a case plus its numbers; the words live in the messages. It only says the
 * state the one primary step acts on: everything else is an item below or a surface line.
 */
export type Headline =
  /** Decisions wait. */
  | { kind: 'decisions'; decisions: number }
  /** Nothing to decide, but code files still have fixed values. */
  | { kind: 'code'; files: number }
  /** No code file was scanned, so there is nothing to compare code with yet. */
  | { kind: 'noCode' }
  /** Nothing to decide, a few smaller things are left. */
  | { kind: 'tasks'; count: number }
  | { kind: 'done' }

/** The one thing to do next: the screen's single primary action. */
export type Step =
  /** Open the inbox at its first open decision. */
  | { kind: 'decisions'; count: number; id: string }
  /** Look at the first code file that waits for tokens (it sits in the inbox's code group). */
  | { kind: 'review'; files: number; id: string }
  /** Tell Accord where the code is (project settings, Code). */
  | { kind: 'connect' }
  /** The most pressing remaining task, with its own action. */
  | { kind: 'finding'; finding: Finding }
  | { kind: 'done' }

/** What one surface's line says after its name. */
export type SurfaceStatus =
  /** Not connected, found but switched off, or switched on without files. */
  | { kind: 'setup'; state: Exclude<SurfaceStateId, 'connected'> }
  /** Decisions from this surface wait in the inbox. */
  | { kind: 'waiting'; count: number; id: string }
  /** Code only: files that wait for tokens. */
  | { kind: 'files'; count: number; id: string }
  /** Connected, but `count` values differ that are not a decision yet (details in the settings). */
  | { kind: 'differs'; count: number }
  | { kind: 'inSync' }

export interface SurfaceLine {
  id: SurfaceId
  status: SurfaceStatus
}

export interface Overview {
  headline: Headline
  step: Step
  items: Finding[]
  /**
   * Code files with fixed values that wait in the inbox while decisions come first: one short item of
   * their own ("1 Datei mit fest eingetragenen Werten"), never part of the sentence.
   */
  files?: { count: number; id: string; file?: string | undefined } | undefined
  surfaces: SurfaceLine[]
  /** Open decisions (needs you and safe to adopt): the one count the sidebar shows. */
  decisions: number
  /** The remaining tasks beyond the short items, for "Details" (never one the screen already shows). */
  more: Finding[]
}

export interface OverviewInput {
  report: DriftReport
  surfaces: Record<SurfaceId, SurfaceHealth>
  /** In inbox order (needs you first), as `loadProjectProposals` returns them. */
  proposals: readonly Proposal[]
}

const isOpen = (p: Pick<ProposalLike, 'group'>) => p.group === 'needsYou' || p.group === 'auto'

/** A code proposal's id is `code:<file>`: the file it is about. */
const fileOf = (id: string | undefined) => (id?.startsWith('code:') ? id.slice('code:'.length) : undefined)

/**
 * The order of the step and the short items: the tasks as ranked, except that code which only has to follow a decision
 * taken here comes before the other small things. It is the direct consequence of deciding, so it is
 * what people look for after inbox zero.
 */
const followFirst = (list: readonly Finding[]): Finding[] => {
  const rank = (f: Finding) =>
    f.severity === 'high' ? 0 : f.severity === 'medium' ? 1 : f.cause === 'follow' ? 2 : 3
  return [...list].sort((a, b) => rank(a) - rank(b))
}

/**
 * A surface with deleted tokens and tokens the register changed asks for the same thing twice: make
 * the tool show the register again. The overview says it once, with the tokens named
 * ("2 Werte in Figma zurückstellen: blue.600, spacing.4"), right after the toast that promised it.
 */
export function mergeReverts(list: readonly Finding[]): Finding[] {
  const out: Finding[] = []
  for (const f of list) {
    if (f.cause !== 'deleted' && f.cause !== 'behind') {
      out.push(f)
      continue
    }
    const other = list.find(
      (g) => g.surface === f.surface && g.cause === (f.cause === 'deleted' ? 'behind' : 'deleted'),
    )
    if (!other) {
      out.push(f)
      continue
    }
    // The pair becomes one item where the deleted one stood (it ranks higher); the other is dropped.
    if (f.cause !== 'deleted') continue
    const tokens = [...(f.tokens ?? []), ...(other.tokens ?? [])].sort()
    const values = { count: tokens.length, tokens: examples(tokens), tool: f.surface }
    out.push({
      ...f,
      id: `${f.surface}:revert`,
      cause: 'revert',
      impact: f.impact + other.impact,
      title: { key: 'finding.revertTitle', values },
      text: { key: 'finding.revertText', values },
      tokens,
    })
  }
  return out
}

/**
 * The words of a task on the overview, as message keys in the `overview` namespace: a title that says
 * what to do ("Gelöschten Token in Figma wiederherstellen") and one sentence how. Both take the values
 * the finding carries.
 */
export function taskText(f: Finding): {
  title: string
  how: string
  values: Record<string, string | number>
} {
  const cause = f.cause === 'unmapped' && f.surface !== 'code' ? 'toolUnmapped' : f.cause
  return {
    title: `task.title.${cause}`,
    how: `task.how.${f.text.key.replace(/^finding\./, '')}`,
    values: { ...f.text.values, ...f.title.values },
  }
}

function surfaceLine(id: SurfaceId, input: OverviewInput): SurfaceLine {
  const { report, proposals } = input
  const surface = input.surfaces[id]
  const handoffs = proposals.filter((p) => p.tool === 'claude-design').length
  const state = surfaceState({
    handoffs: id === 'claude-design',
    enabled: id === 'code' || surface.enabled,
    found:
      id === 'code' ? report.code.filesScanned : id === 'claude-design' ? handoffs : surface.files.length,
  })
  if (state.id !== 'connected') return { id, status: { kind: 'setup', state: state.id } }

  const open = proposals.filter((p) => p.tool === id && isOpen(p))
  if (open[0]) return { id, status: { kind: 'waiting', count: open.length, id: open[0].id } }
  const files = proposals.filter((p) => p.tool === id && p.group === 'code')
  if (files[0]) return { id, status: { kind: 'files', count: files.length, id: files[0].id } }
  const next = nextAction(surface, proposals, report)
  // Code that only has to follow a decision taken here is not a difference: it costs nothing.
  if (next.kind === 'command' && next.reason !== 'follow')
    return { id, status: { kind: 'differs', count: surface.items.length } }
  return { id, status: { kind: 'inSync' } }
}

export function overviewOf(input: OverviewInput): Overview {
  const { report, proposals } = input
  const open = proposals.filter(isOpen)
  const files = proposals.filter((p) => p.group === 'code')
  const measurable = report.code.filesScanned > 0
  // Proposals are the inbox's business; here only what is not a decision is a task.
  const tasks = followFirst(mergeReverts(buildFindings(input).filter((f) => f.cause !== 'proposal')))

  let step: Step
  if (open[0]) step = { kind: 'decisions', count: open.length, id: open[0].id }
  else if (files[0]) step = { kind: 'review', files: files.length, id: files[0].id }
  else if (!measurable) step = { kind: 'connect' }
  else if (tasks[0]) step = { kind: 'finding', finding: tasks[0] }
  else step = { kind: 'done' }

  // Nothing is said twice: not the step's own task, and not a code file that waits in the inbox (the
  // step, the files item or the Code line links to it).
  const covered = (f: Finding) =>
    (step.kind === 'finding' && f.id === step.finding.id) ||
    f.action.kind === 'proposal' ||
    (step.kind === 'connect' && f.cause === 'noFiles')
  const rest = tasks.filter((f) => !covered(f))

  // The sentence says what the step is about, nothing more.
  const headline: Headline =
    step.kind === 'decisions'
      ? { kind: 'decisions', decisions: step.count }
      : step.kind === 'review'
        ? { kind: 'code', files: step.files }
        : step.kind === 'connect'
          ? { kind: 'noCode' }
          : step.kind === 'finding'
            ? { kind: 'tasks', count: tasks.length }
            : { kind: 'done' }
  const waitingFiles =
    step.kind === 'decisions' && files[0]
      ? { count: files.length, id: files[0].id, file: fileOf(files[0].id) }
      : undefined
  const room = OVERVIEW_ITEMS - (waitingFiles ? 1 : 0)

  return {
    headline,
    step,
    items: rest.slice(0, room),
    files: waitingFiles,
    more: rest.slice(room),
    surfaces: SURFACE_ORDER.map((id) => surfaceLine(id, input)),
    decisions: open.length,
  }
}
