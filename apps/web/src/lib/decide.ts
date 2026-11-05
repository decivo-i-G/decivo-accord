import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import {
  ApplyError,
  type ApplyPlan,
  planApply,
  RESOLUTION_SCHEMA,
  type Resolution,
  ResolutionSchema,
  resolutionFor,
  writeApply,
} from '@decivo/accord-cli'
import { type Project, registerDirOf } from './projects'
import { findStoredProposal, type Option, type StoredProposal } from './proposals'

/** What a written file is, in words a designer knows. */
export type FileKind = 'register' | 'css' | 'changelog' | 'agents' | 'proposal' | 'other'

export interface FileChange {
  path: string
  kind: FileKind
}

export type DecideErrorCode =
  | 'not_found'
  | 'already_resolved'
  | 'invalid_value'
  | 'invalid_edit'
  | 'must_violation'
  | 'stale'
  | 'dirty'
  | 'needs_confirmation'
  | 'needs_names'
  | 'invalid_input'

export type DecideResult =
  | { ok: true; option: Option; files: FileChange[]; tokens: string[]; undo: string }
  | { ok: false; code: DecideErrorCode; detail?: string | undefined }

/** A colour from a handoff that the person names as a new token. */
export interface NamedColor {
  value: string
  token: string
}

export interface DecideInput {
  id: string
  option: Option
  by: string
  note?: string | undefined
  /** Handoffs: names for new colours (adopt only). */
  names?: NamedColor[] | undefined
  /** The person confirmed a deletion or breaking change. Without it such an adoption is refused. */
  confirmed?: boolean | undefined
}

const exec = promisify(execFile)

/** Who decides, by default: `git config user.name` in the project (local mode), else the system user. */
export async function defaultDecider(project: Project): Promise<string> {
  const name = await exec('git', ['config', 'user.name'], { cwd: project.root, timeout: 2000 })
    .then((r) => r.stdout.trim())
    .catch(() => '')
  return name || process.env.USER || ''
}

function classify(path: string, plan: ApplyPlan): FileKind {
  if (path === plan.proposalFile) return 'proposal'
  if (plan.tokenFiles.some((f) => f.path === path)) return 'register'
  const name = path.split('/').pop() ?? path
  if (/^changelog/i.test(name)) return 'changelog'
  if (name.endsWith('.css') || name.endsWith('.scss')) return 'css'
  if (/^(agents|claude|design)\.md$/i.test(name) || path.includes('.cursor/') || path.includes('.github/'))
    return 'agents'
  return 'other'
}

/** Every file the decision writes, with the content it gets. */
const writesOf = (plan: ApplyPlan): { path: string; content: string }[] => [
  ...plan.tokenFiles,
  ...plan.outputs.map((o) => ({ path: o.path, content: o.content })),
  { path: plan.proposalFile, content: plan.proposalContent },
  ...(plan.lockFile ? [plan.lockFile] : []),
]

const filesOf = (plan: ApplyPlan): FileChange[] =>
  writesOf(plan).map(({ path }) => ({ path, kind: classify(path, plan) }))

/** True when adopting it deletes a token or breaks existing uses: a person has to say so explicitly. */
export function isRisky(stored: StoredProposal): boolean {
  if (stored.source === 'claude-design') return false
  return (
    stored.changes.some((c) => c.kind === 'remove') ||
    stored.reasons.some((r) => r.code === 'deletion' || r.code === 'breaking')
  )
}

/** The resolution for a decision, made by Accord's own `resolutionFor` (and its schema for named handoff colours). */
function resolutionOf(
  raw: unknown,
  stored: StoredProposal,
  input: DecideInput,
  now: Date,
): Resolution | { error: DecideErrorCode; detail?: string } {
  if (stored.source === 'claude-design' && input.option === 'adopt') {
    const allowed = new Set([...stored.colors.new, ...stored.colors.nearMisses].map((c) => c.value))
    const names = (input.names ?? []).filter((n) => n.token.trim() !== '')
    if (names.length === 0) return { error: 'needs_names' }
    const foreign = names.find((n) => !allowed.has(n.value))
    if (foreign) return { error: 'invalid_input', detail: foreign.value }
    const parsed = ResolutionSchema.safeParse({
      schema: RESOLUTION_SCHEMA,
      proposal: stored.id,
      option: 'adopt',
      items: names.map((n) => ({ token: n.token.trim(), kind: 'new', type: 'color', value: n.value })),
      by: input.by,
      at: now.toISOString(),
      ...(input.note ? { note: input.note } : {}),
    })
    return parsed.success
      ? parsed.data
      : { error: 'invalid_input', detail: parsed.error.issues[0]?.message ?? '' }
  }
  return resolutionFor(raw as Parameters<typeof resolutionFor>[0], {
    option: input.option,
    by: input.by,
    note: input.note,
    now,
  })
}

const errorOf = (error: unknown): DecideResult => {
  if (error instanceof ApplyError) return { ok: false, code: error.code, detail: error.message }
  throw error
}

/** What adopting would change, without changing anything (Accord's `planApply`). */
export async function adoptPreview(
  project: Project,
  id: string,
): Promise<{ ok: true; files: FileChange[] } | { ok: false; code: DecideErrorCode; detail?: string }> {
  const entry = await findStoredProposal(project, id)
  if (!entry) return { ok: false, code: 'not_found' }
  if (entry.data.source === 'claude-design') return { ok: false, code: 'needs_names' }
  try {
    const resolution = resolutionFor(entry.raw as Parameters<typeof resolutionFor>[0], {
      option: 'adopt',
      by: 'preview',
    })
    const plan = await planApply({ root: project.root, registerDir: registerDirOf(project), resolution })
    return { ok: true, files: filesOf(plan) }
  } catch (error) {
    if (error instanceof ApplyError) return { ok: false, code: error.code, detail: error.message }
    throw error
  }
}

// --- Undo ---------------------------------------------------------------------------------------
// A decision can be taken back for a few minutes: the files it wrote get their previous content again.
// Kept in memory (local mode, one server); a restart simply forgets it.

interface Snapshot {
  root: string
  slug: string
  /** The decided proposal. */
  proposal: string
  at: number
  /** Each file before the decision, and what the decision wrote into it. */
  files: { path: string; content: string | undefined; written: string }[]
}

const UNDO_MS = 10 * 60_000
const store = globalThis as typeof globalThis & { __accordUndo?: Map<string, Snapshot> }
if (!store.__accordUndo) store.__accordUndo = new Map<string, Snapshot>()
const snapshots = store.__accordUndo

const inside = (root: string, path: string) => {
  const full = resolve(root, path)
  if (full !== root && !full.startsWith(`${root}${sep}`)) throw new Error(`outside the project: ${path}`)
  return full
}

/** Decide a stored proposal: Accord's resolution, plan and write (local mode: no branch). */
export async function decideProposal(
  project: Project,
  input: DecideInput,
  now = new Date(),
): Promise<DecideResult> {
  const entry = await findStoredProposal(project, input.id)
  if (!entry) return { ok: false, code: 'not_found' }
  if (!input.by.trim()) return { ok: false, code: 'invalid_input', detail: 'by' }
  if (input.option === 'adopt' && isRisky(entry.data) && !input.confirmed)
    return { ok: false, code: 'needs_confirmation' }
  try {
    const resolution = resolutionOf(entry.raw, entry.data, { ...input, by: input.by.trim() }, now)
    if ('error' in resolution) return { ok: false, code: resolution.error, detail: resolution.detail }
    const plan = await planApply({ root: project.root, registerDir: registerDirOf(project), resolution })
    const root = resolve(project.root)
    const files = filesOf(plan)
    const before = await Promise.all(
      writesOf(plan).map(async (f) => ({
        path: f.path,
        content: await readFile(inside(root, f.path), 'utf8').catch(() => undefined),
        written: f.content,
      })),
    )
    await writeApply(plan, { root: project.root, branch: false, push: false })
    const undo = randomUUID()
    for (const [key, s] of snapshots) if (Date.now() - s.at > UNDO_MS) snapshots.delete(key)
    snapshots.set(undo, { root, slug: project.slug, proposal: input.id, at: Date.now(), files: before })
    return {
      ok: true,
      option: input.option,
      files,
      tokens: resolution.items.map((i) => i.token),
      undo,
    }
  } catch (error) {
    return errorOf(error)
  }
}

/** The newest undo of a proposal's decision that still works, if any. */
export function undoOf(project: Pick<Project, 'slug'>, proposal: string): string | undefined {
  let found: { key: string; at: number } | undefined
  for (const [key, s] of snapshots)
    if (s.slug === project.slug && s.proposal === proposal && Date.now() - s.at <= UNDO_MS)
      if (!found || s.at > found.at) found = { key, at: s.at }
  return found?.key
}

/** Take a decision back (restore the files it wrote). False when it is too old or unknown. */
export async function undoDecision(project: Project, undo: string): Promise<boolean> {
  const snapshot = snapshots.get(undo)
  if (!snapshot || snapshot.slug !== project.slug || Date.now() - snapshot.at > UNDO_MS) return false
  // Only while the files still hold what the decision wrote: a later decision (here or on the command
  // line) or a hand edit would otherwise be overwritten with the old content.
  for (const file of snapshot.files) {
    const now = await readFile(inside(snapshot.root, file.path), 'utf8').catch(() => undefined)
    if (now !== file.written) return false
  }
  snapshots.delete(undo)
  for (const file of snapshot.files) {
    const full = inside(snapshot.root, file.path)
    if (file.content === undefined) {
      await rm(full, { force: true })
      // A folder the decision created (`.accord/generated/`) goes with its last file.
      await rmdir(dirname(full)).catch(() => {})
    } else {
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, file.content)
    }
  }
  return true
}
