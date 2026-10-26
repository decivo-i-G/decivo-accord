import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import {
  analyseHandoff,
  type DraftColor,
  designSystemStatus,
  readDesignSystemMirror,
  readHandoff,
  resetPlan,
} from '@decivo/accord-adapter-claude-design'
import { prepareCodeScan } from '@decivo/accord-adapter-code'
import { type Evaluation, evaluate, type LiteralUse } from '@decivo/accord-checks'
import {
  type ColorValue,
  LOCK_FILE,
  parseLock,
  type Register,
  serializeLock,
  withLockedSnapshot,
} from '@decivo/accord-core'
import { loadValidRegister } from '@decivo/accord-core/node'
import { git } from './git.js'

export interface HandoffProposal {
  id: string
  source: 'claude-design'
  bundle: { name: string; primary?: string | undefined; pages: string[] }
  createdAt: string
  route: Evaluation['route']
  decider?: Evaluation['decider']
  colors: { inRegister: DraftColor[]; nearMisses: DraftColor[]; new: DraftColor[] }
  violations: {
    decision: string
    level: string
    rule: string
    why: string
    value: string
    nearest?: string | undefined
    count: number
  }[]
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'handoff'

/** Token usage from the code, so suggestions prefer tokens the product already uses. Empty when there is no code. */
async function usage(root: string, register: Register): Promise<Map<string, number>> {
  try {
    return (await prepareCodeScan({ root, register })).tokenUsage
  } catch {
    return new Map()
  }
}

/**
 * Turn a Claude Design handoff into a proposal: map every colour to register tokens and evaluate it
 * like any other change. A handoff never changes the register directly; it becomes a proposal for the owner.
 */
export async function ingestHandoff(input: {
  root: string
  registerDir: string
  bundle: string
  now?: Date
}): Promise<HandoffProposal> {
  const root = resolve(input.root)
  const register = await loadValidRegister(input.registerDir)
  const bundle = await readHandoff(input.bundle)
  const analysis = analyseHandoff(bundle, register, { tokenUsage: await usage(root, register) })

  const literals: LiteralUse[] = analysis.literals.map((l) => ({
    file: l.file,
    line: l.line,
    column: l.column,
    raw: l.raw,
    kind: l.kind,
    value: l.value as ColorValue,
    replacement: l.match.exact[0],
    near: l.match.near,
  }))
  const evaluation = await evaluate({
    register,
    change: { source: 'claude-design', intent: 'proposal', items: [], literals },
  })

  // One violation per decision and colour, not one per occurrence.
  const grouped = new Map<string, HandoffProposal['violations'][number]>()
  for (const v of evaluation.literalViolations) {
    const value = String(v.detail.value ?? '').toLowerCase()
    const key = `${v.decisionId}|${value}`
    const entry = grouped.get(key) ?? {
      decision: v.decisionId,
      level: v.level,
      rule: v.rule,
      why: v.why,
      value,
      nearest: v.replacement,
      count: 0,
    }
    entry.count++
    grouped.set(key, entry)
  }

  const now = input.now ?? new Date()
  return {
    id: `P-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${slug(bundle.name)}`,
    source: 'claude-design',
    bundle: { name: bundle.name, primary: bundle.primary, pages: bundle.pages.map((p) => p.title ?? p.path) },
    createdAt: now.toISOString(),
    route: evaluation.route,
    decider: evaluation.decider,
    colors: {
      inRegister: analysis.colors.filter((c) => c.exact.length > 0),
      nearMisses: analysis.colors.filter((c) => c.exact.length === 0 && c.near),
      new: analysis.colors.filter((c) => c.exact.length === 0 && !c.near),
    },
    violations: [...grouped.values()].sort((a, b) => b.count - a.count),
  }
}

/** Write the proposal into the register (`proposals/`); with `branch`, on a new git branch, never on main. */
export async function saveProposal(
  proposal: HandoffProposal,
  input: { root: string; registerDir: string; branch: boolean },
): Promise<{ file: string; branch?: string | undefined }> {
  const file = join(input.registerDir, 'proposals', `${proposal.id}.json`)
  let branch: string | undefined
  if (input.branch) {
    branch = `accord/handoff-${proposal.id.toLowerCase()}`
    await git(input.root, ['checkout', '-b', branch])
  }
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(proposal, null, 2)}\n`)
  if (branch) {
    await git(input.root, ['add', relative(input.root, file)])
    await git(input.root, [
      'commit',
      '-m',
      `accord: proposal ${proposal.id} from Claude Design handoff "${proposal.bundle.name}"`,
    ])
  }
  return { file, branch }
}

// --- Design-system project ---

export async function designStatus(input: { registerDir: string; mirror: string }) {
  const register = await loadValidRegister(input.registerDir)
  const lock = parseLock(await readFile(join(input.registerDir, LOCK_FILE), 'utf8').catch(() => undefined))
  const mirror = await readDesignSystemMirror(input.mirror)
  const status = designSystemStatus(mirror, register, lock)
  return { register, lock, mirror, status, plan: resetPlan(mirror, register, status) }
}

/** Rewrite drifted values in the mirror so `/design-sync` can upload them. */
export async function designReset(input: { registerDir: string; mirror: string }) {
  const { plan } = await designStatus(input)
  for (const file of plan.files) await writeFile(join(input.mirror, file.path), file.content)
  return plan
}

/** Record the mirror as the synced state of Claude Design (run after `/design-sync` uploaded it). */
export async function designLock(input: { registerDir: string; mirror: string; now?: Date }) {
  const { lock, status } = await designStatus(input)
  const next = withLockedSnapshot(lock, 'claude-design', status.snapshot, input.now ?? new Date())
  await writeFile(join(input.registerDir, LOCK_FILE), serializeLock(next))
  return status.snapshot.tokens.size
}
