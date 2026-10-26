import type { NextAction } from './findings'
import type { SurfaceLine } from './overview'
import { type DecisionSource, decisionsHref } from './routes'
import { surfaceState } from './surface-state'

/**
 * One row per surface on the Connections screen (project settings): its state in plain words and at
 * most one next step. Everything a developer needs (paths, patterns, Figma modes, commands) lives
 * behind "For developers" and is not decided here. The state follows the overview's surface line, so
 * both screens always say the same thing. What waits in the inbox is the overview's and the inbox's
 * business: a row here answers "is it connected, and what is the one step to connect it", never
 * "go and decide".
 */

export type ConnectionTool = 'code' | 'figma' | 'pen' | 'claude_design'

export type ConnectionState =
  /** Not connected, found but switched off, or switched on without files. */
  | { kind: 'off' | 'foundOff' | 'noFiles' }
  | { kind: 'waiting'; count: number; id: string }
  /** Code only: files that wait for tokens. */
  | { kind: 'files'; count: number; id: string }
  /** Connected, but values differ that are not a decision yet (`count` when known). */
  | { kind: 'differs'; count?: number | undefined }
  | { kind: 'inSync' }
  /** The files were found but could not be read. */
  | { kind: 'unreadable' }

/** Why a connected surface differs, as a plain sentence; its command sits behind "For developers". */
export type DiffersReason = Extract<NextAction, { kind: 'command' }>['reason']

export type ConnectionNext =
  /** Found but switched off: the row's switch is the step. */
  | { kind: 'switchOn' }
  /** Nothing found yet: how to add a file (Figma, Pencil) or a handoff (Claude Design). */
  | { kind: 'addFile' }
  /** Files exist, but outside the paths Accord reads. */
  | { kind: 'outside'; count: number }
  /** Code lives in folders the include patterns miss ("app/ and components/, Accord looks in src/"). */
  | { kind: 'codeOutside'; found: string[]; include: string[] }
  | { kind: 'reason'; reason: DiffersReason }

export interface ConnectionRowInput {
  tool: ConnectionTool
  /** The overview's line for this surface, when the project's health could be read. */
  line?: SurfaceLine | undefined
  enabled: boolean
  /** Files (Figma, Pencil), scanned code files, or handoffs (Claude Design). */
  found: number
  unreadable?: boolean | undefined
  /** Figma or Pencil files in the usual places outside the include patterns. */
  outside?: number | undefined
  /** Code only: folders with code the include patterns miss, and the folders they look in. */
  missed?: { found: string[]; include: string[] } | undefined
  /** The surface's next action from findings, for the reason of a difference. */
  action?: NextAction | undefined
}

export interface ConnectionRow {
  tool: ConnectionTool
  state: ConnectionState
  next?: ConnectionNext | undefined
}

function stateOf(input: ConnectionRowInput): ConnectionState {
  if (input.unreadable) return { kind: 'unreadable' }
  const status = input.line?.status
  if (status) return status.kind === 'setup' ? { kind: status.state } : status
  // Without health, only what was found and switched on is known.
  const { id } = surfaceState({
    enabled: input.tool === 'code' || input.enabled,
    found: input.found,
    handoffs: input.tool === 'claude_design',
  })
  return id === 'connected' ? { kind: 'inSync' } : { kind: id }
}

function nextOf(input: ConnectionRowInput, state: ConnectionState): ConnectionNext | undefined {
  const { tool, missed, outside = 0, action } = input
  // Waiting decisions and code files are the inbox's: the overview and the sidebar count lead there.
  if (state.kind === 'waiting' || state.kind === 'files') return undefined
  if (tool === 'code' && missed && missed.found.length > 0) return { kind: 'codeOutside', ...missed }
  if (state.kind === 'unreadable') return { kind: 'reason', reason: 'unreadable' }
  if (state.kind === 'foundOff') return { kind: 'switchOn' }
  if (state.kind === 'off' || state.kind === 'noFiles') {
    if (tool === 'code') return { kind: 'reason', reason: 'noFiles' }
    if (outside > 0 && tool !== 'claude_design') return { kind: 'outside', count: outside }
    return { kind: 'addFile' }
  }
  if (state.kind === 'differs' && action?.kind === 'command') return { kind: 'reason', reason: action.reason }
  return undefined
}

export function connectionRow(input: ConnectionRowInput): ConnectionRow {
  const state = stateOf(input)
  return { tool: input.tool, state, next: nextOf(input, state) }
}

/**
 * Connected: Accord compares the surface with the register (whatever waits in the inbox). Not
 * connected: nothing to compare yet, switched off, unreadable, or code in folders Accord misses.
 */
export function isConnected(row: ConnectionRow): boolean {
  if (row.next?.kind === 'codeOutside') return false
  return ['inSync', 'waiting', 'files', 'differs'].includes(row.state.kind)
}

/** The page's state at a glance: which surfaces are connected and which are not yet. */
export type ConnectionSummary =
  | { kind: 'all' }
  | { kind: 'none' }
  | { kind: 'some'; connected: ConnectionTool[]; missing: ConnectionTool[] }

export function connectionSummary(rows: readonly ConnectionRow[]): ConnectionSummary {
  const connected = rows.filter(isConnected).map((r) => r.tool)
  const missing = rows.filter((r) => !isConnected(r)).map((r) => r.tool)
  if (missing.length === 0) return { kind: 'all' }
  if (connected.length === 0) return { kind: 'none' }
  return { kind: 'some', connected, missing }
}

/**
 * Does a connected surface match the register? The row's one sentence under its state, so the check
 * icon means "in sync" here as on the overview. `places` counts token paths: those the tool's status
 * (`accord figma|pen status`) finds different, and those its open decisions change. `id` is the first
 * open decision from this surface; without one there is nothing to open, so the sentence has no link.
 */
export type Agreement =
  | { kind: 'inSync' }
  | { kind: 'drift'; count: number; unit: 'places' | 'files' | 'handoffs'; id?: string | undefined }

export function agreementOf(row: ConnectionRow, differing?: readonly string[]): Agreement | undefined {
  if (!isConnected(row)) return undefined
  const { state } = row
  if (state.kind === 'inSync') return { kind: 'inSync' }
  const id = state.kind === 'waiting' || state.kind === 'files' ? state.id : undefined
  if (row.tool === 'figma' || row.tool === 'pen') {
    const count = differing?.length || ('count' in state ? (state.count ?? 0) : 0)
    return { kind: 'drift', count, unit: 'places', id }
  }
  const count = 'count' in state ? (state.count ?? 0) : 0
  const unit = state.kind === 'files' ? 'files' : row.tool === 'claude_design' ? 'handoffs' : 'places'
  return { kind: 'drift', count, unit, id }
}

/** The inbox filter for a surface: Claude Design is `claude-design` there. */
export const sourceOfTool = (tool: ConnectionTool): DecisionSource =>
  tool === 'claude_design' ? 'claude-design' : tool

/**
 * Where a surface's sentence links when it differs: the inbox filtered to that surface, so every
 * decision from it is in one list (not only the first). In sync, or nothing open: no link.
 */
export function agreementHref(slug: string, tool: ConnectionTool, agreement: Agreement | undefined) {
  return agreement?.kind === 'drift' && agreement.id ? decisionsHref(slug, sourceOfTool(tool)) : undefined
}

/**
 * The token paths where Figma or Pencil differ from the register: what the tool's status found, and
 * what its open decisions change (a value already proposed is no longer a difference in the status).
 */
export function differingTokens(
  items: readonly { token: string }[],
  open: readonly { changes: readonly { token: string }[] }[],
): string[] {
  const path = (token: string) => token.replace(/^tokens\./, '')
  return [
    ...new Set([
      ...items.map((i) => path(i.token)),
      ...open.flatMap((p) => p.changes.map((c) => path(c.token))),
    ]),
  ]
}
