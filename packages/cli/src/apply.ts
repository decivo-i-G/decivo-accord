import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { cssToTokenValue } from '@decivo/accord-adapter-code'
import { type Evaluation, evaluate } from '@decivo/accord-checks'
import {
  applyTokenEdits,
  type ChangeOp,
  type ColorValue,
  classify,
  colorToCss,
  contextLabel,
  cssToColor,
  type EditResult,
  formatValue,
  type Register,
  TOKEN_TYPES,
  type TokenEdit,
  type TokenType,
} from '@decivo/accord-core'
import { readValidRegister } from '@decivo/accord-core/node'
import { type PlannedOutput, planExport } from '@decivo/accord-generators'
import { z } from 'zod'
import type { HandoffProposal } from './claude-design.js'
import { git } from './git.js'
import type { SurfaceProposal } from './surface-proposal.js'
import { writeOutput } from './write.js'

export const RESOLUTION_SCHEMA = 'accord.resolution/1'

/**
 * A person's decision on a proposal, wherever it was made (the command line, the web app, or any review tool
 * that writes a resolution file).
 * Accord turns it into a register change; it never decides on its own.
 */
export const ResolutionSchema = z
  .object({
    schema: z.literal(RESOLUTION_SCHEMA),
    proposal: z.string().regex(/^P-[A-Za-z0-9-]+$/, 'proposal id like P-20261012-landing'),
    /** adopt: the draft wins and the register changes. reset: the register stays. reject: drop the proposal. */
    option: z.enum(['adopt', 'reset', 'reject']),
    items: z
      .array(
        z
          .object({
            /** Register token path without the `tokens.` prefix, e.g. `color.brand.600`. */
            token: z.string().min(1),
            /** CSS value in the token's type, e.g. `#4a7b9a`, `8px`, `700`. Not for `remove`. */
            value: z.string().min(1).optional(),
            /**
             * change: an existing token gets the value. new: a token is created (the person chose its name).
             * remove: the token is deleted (refused while other tokens point to it).
             */
            kind: z.enum(['change', 'new', 'remove']),
            /** Type of a new token (default colour); a changed token keeps its type. */
            type: z.enum(TOKEN_TYPES).optional(),
            description: z.string().optional(),
            /**
             * The context the item is about, e.g. `dark`: change sets the token's value there, remove takes the
             * token's own value there away (it falls back to the default). Absent: the default context.
             */
            context: z.string().min(1).optional(),
          })
          .refine((i) => i.kind === 'remove' || i.value !== undefined, {
            message: 'change and new need a value',
            path: ['value'],
          })
          .refine((i) => i.kind !== 'new' || i.context === undefined, {
            message: 'a new token is created in the default context; set its other values with change',
            path: ['context'],
          }),
      )
      .default([]),
    by: z.string().min(1),
    at: z.iso.datetime({ offset: true }),
    /** Where the decision was made, free text, e.g. `review:123`. */
    ref: z.string().optional(),
    note: z.string().optional(),
  })
  .refine((r) => (r.option === 'adopt') === r.items.length > 0, {
    message: 'adopt needs at least one item; reset and reject take none',
    path: ['items'],
  })

export type Resolution = z.infer<typeof ResolutionSchema>

/** What Accord records on the proposal once it is decided. The proposal file stays as history. */
export type ProposalResolution = Omit<Resolution, 'schema' | 'proposal'>

export class ApplyError extends Error {
  constructor(
    readonly code: 'not_found' | 'already_resolved' | 'invalid_value' | 'invalid_edit' | 'must_violation',
    message: string,
  ) {
    super(message)
    this.name = 'ApplyError'
  }
}

export interface ApplyPlan {
  proposal: (HandoffProposal | SurfaceProposal) & { resolution?: ProposalResolution }
  resolution: Resolution
  /** Register path of the proposal file, e.g. `.accord/proposals/P-….json` (relative to the root). */
  proposalFile: string
  /** Token files that change, relative to the root. */
  tokenFiles: { path: string; content: string }[]
  ops: ChangeOp[]
  evaluation?: Evaluation | undefined
  /** Generated files that change (DESIGN.md, AGENTS.md, CSS …). */
  outputs: PlannedOutput[]
  /** The proposal file with its resolution. */
  proposalContent: string
}

const posix = (path: string) => path.split('\\').join('/')

/** Turn the resolution's items into token edits; values are stored the way the register stores them. */
function toEdits(resolution: Resolution, register: Register): TokenEdit[] {
  return resolution.items.map((item): TokenEdit => {
    if (item.kind === 'remove' && item.context !== undefined && item.context !== register.modes?.default)
      return { kind: 'unset', path: item.token, context: item.context }
    if (item.kind === 'remove') return { kind: 'remove', path: item.token }
    const type: TokenType =
      item.kind === 'change' ? (register.tokens.get(item.token)?.type ?? 'color') : (item.type ?? 'color')
    const css = item.value as string
    const value = type === 'color' ? cssToColor(css) : cssToTokenValue(type, css)
    if (value === undefined)
      throw new ApplyError(
        'invalid_value',
        `${item.token}: "${css}" is not ${type === 'color' ? 'a colour' : `a ${type} value`}`,
      )
    return item.kind === 'change'
      ? { kind: 'set', path: item.token, value, ...(item.context ? { context: item.context } : {}) }
      : { kind: 'add', path: item.token, type, value, description: item.description }
  })
}

/**
 * The resolution for a decision taken on the command line (`--proposal … --option … --by …`): adopting
 * a Figma or Pencil proposal takes over exactly its changes. A handoff proposal names no tokens, so its
 * adoption needs a resolution file in which the person names them.
 */
export function resolutionFor(
  proposal: (HandoffProposal | SurfaceProposal) & { resolution?: unknown },
  decision: { option: Resolution['option']; by: string; note?: string | undefined; now?: Date },
): Resolution {
  const changes = 'changes' in proposal ? proposal.changes : []
  if (decision.option === 'adopt' && changes.length === 0)
    throw new ApplyError(
      'invalid_edit',
      `proposal ${proposal.id} names no tokens; decide it with --resolution`,
    )
  return ResolutionSchema.parse({
    schema: RESOLUTION_SCHEMA,
    proposal: proposal.id,
    option: decision.option,
    items:
      decision.option === 'adopt'
        ? changes.map((c) => ({
            token: c.token,
            kind: c.kind,
            ...(c.kind === 'remove' ? {} : { value: c.after, type: c.type }),
            ...('context' in c && c.context ? { context: c.context } : {}),
          }))
        : [],
    by: decision.by,
    at: (decision.now ?? new Date()).toISOString(),
    ...(decision.note ? { note: decision.note } : {}),
  })
}

/**
 * Everything `accord apply` would change, without changing it. Refuses an unknown or already decided
 * proposal, and an adoption that breaks a `must` rule: a person may decide a breaking change or a new
 * colour, but a rule only changes through its own proposal.
 */
export async function planApply(input: {
  root: string
  registerDir: string
  resolution: Resolution
}): Promise<ApplyPlan> {
  const root = resolve(input.root)
  const { resolution } = input
  const proposalPath = join(input.registerDir, 'proposals', `${resolution.proposal}.json`)
  const raw = await readFile(proposalPath, 'utf8').catch(() => undefined)
  if (raw === undefined) throw new ApplyError('not_found', `proposal ${resolution.proposal} not found`)
  const proposal = JSON.parse(raw) as ApplyPlan['proposal']
  if (proposal.resolution)
    throw new ApplyError(
      'already_resolved',
      `proposal ${proposal.id} was already decided (${proposal.resolution.option} by ${proposal.resolution.by})`,
    )

  const { files, register } = await readValidRegister(input.registerDir)

  let edited: EditResult = { files: [], register, ops: [] }
  let evaluation: Evaluation | undefined
  if (resolution.option === 'adopt') {
    try {
      edited = applyTokenEdits(files, register, toEdits(resolution, register))
    } catch (error) {
      if (error instanceof ApplyError) throw error
      throw new ApplyError('invalid_edit', (error as Error).message)
    }
    evaluation = await evaluate({
      register: edited.register,
      change: {
        source: proposal.source,
        intent: 'proposal',
        items: edited.ops.map((op) => ({ op, origin: 'surface', classification: classify(op) })),
        literals: [],
      },
    })
    // "Outside the scale" on a token the person named is the decision itself (a new colour becomes part of the
    // register). Every other must rule still holds, e.g. contrast: a decision changes values, not rules.
    const named = new Set(resolution.items.map((i) => `tokens.${i.token}`))
    const broken = evaluation.items
      .flatMap((i) => i.violations)
      .filter((v) => v.level === 'must' && !(v.code === 'outside_scale' && named.has(v.at)))
    if (broken.length > 0)
      throw new ApplyError(
        'must_violation',
        broken.map((v) => `${v.at}: ${v.decisionId} – ${v.rule}`).join('; '),
      )
  }

  const registerRel = posix(relative(root, input.registerDir)) || '.'
  const { schema: _schema, proposal: _id, ...decided } = resolution
  const proposalContent = `${JSON.stringify({ ...proposal, resolution: decided }, null, 2)}\n`
  // The export already sees the decided proposal, so the changelog lists this decision.
  const proposalRegisterPath = `proposals/${resolution.proposal}.json`
  const outputs = (
    await planExport({
      register: edited.register,
      files: files.map((f) =>
        f.path === proposalRegisterPath
          ? { ...f, content: proposalContent }
          : (edited.files.find((e) => e.path === f.path) ?? f),
      ),
      registerDir: registerRel,
      read: (path) => readFile(join(root, path), 'utf8').catch(() => undefined),
    })
  ).filter((o) => o.changed)

  return {
    proposal,
    resolution,
    proposalFile: posix(relative(root, proposalPath)),
    tokenFiles: edited.files.map((f) => ({ path: `${registerRel}/${f.path}`, content: f.content })),
    ops: edited.ops,
    evaluation,
    outputs,
    proposalContent,
  }
}

export interface ChangeLine {
  /** Token path without the `tokens.` prefix. */
  path: string
  /** The context the value is in (`dark`); absent for the default context. */
  context?: string | undefined
  /** The context's own value is removed; the default value applies there. */
  unset?: boolean | undefined
  /** Value before, absent for a new token. */
  before?: string | undefined
  /** Value after, absent for a removed token. */
  after?: string | undefined
}

const show = (type: Parameters<typeof formatValue>[0], value: unknown) =>
  type === 'color' ? colorToCss(value as ColorValue) : formatValue(type, value)

/** The token changes as before/after values, for the terminal and the commit message. */
export function changeLines(ops: readonly ChangeOp[]): ChangeLine[] {
  return ops.flatMap((op): ChangeLine[] => {
    const path = op.path.replace(/^tokens\./, '')
    if (op.kind === 'token.value_changed' && op.context)
      return [
        {
          path,
          context: contextLabel(op.context),
          before: show(op.type, op.before),
          after: show(op.type, op.after),
          ...(op.fallback === 'after' ? { unset: true } : {}),
        },
      ]
    if (op.kind === 'token.value_changed')
      return [{ path, before: show(op.type, op.before), after: show(op.type, op.after) }]
    if (op.kind === 'token.added') return [{ path, after: show(op.after.type, op.after.value) }]
    if (op.kind === 'token.removed') return [{ path, before: show(op.before.type, op.before.value) }]
    return []
  })
}

/**
 * Write the plan: token files, generated files and the decided proposal. With `branch`, all of it is
 * committed on `accord/apply-<id>` (never on main); with `push`, the branch goes to origin.
 */
export async function writeApply(
  plan: ApplyPlan,
  input: { root: string; branch: boolean; push: boolean },
): Promise<{ files: string[]; branch?: string | undefined }> {
  const root = resolve(input.root)
  const branch = input.branch ? `accord/apply-${plan.proposal.id.toLowerCase()}` : undefined
  if (branch) await git(root, ['checkout', '-b', branch])

  const writes = [
    ...plan.tokenFiles,
    ...plan.outputs.map((o) => ({ path: o.path, content: o.content })),
    { path: plan.proposalFile, content: plan.proposalContent },
  ]
  for (const file of [...plan.tokenFiles, { path: plan.proposalFile, content: plan.proposalContent }]) {
    await mkdir(dirname(join(root, file.path)), { recursive: true })
    await writeFile(join(root, file.path), file.content)
  }
  for (const output of plan.outputs) await writeOutput(root, output.path, output.content)
  const paths = writes.map((w) => w.path)

  if (branch) {
    const r = plan.resolution
    const subject = `accord: ${r.option} ${plan.proposal.id} – decided by ${r.by}${r.ref ? ` (${r.ref})` : ''}`
    const body = [
      ...(r.note ? [r.note, ''] : []),
      ...changeLines(plan.ops).map(
        (c) =>
          `${c.path}${c.context ? ` (${c.context})` : ''}: ${c.before ?? '(new)'} -> ${c.unset ? '(own value removed)' : (c.after ?? '(removed)')}`,
      ),
    ].join('\n')
    await git(root, ['add', '--', ...paths])
    await git(root, ['commit', '-m', subject, ...(body ? ['-m', body] : []), '--', ...paths])
    if (input.push) await git(root, ['push', '-u', 'origin', branch])
  }
  return { files: paths, branch }
}
