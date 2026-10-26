import { access, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { figmaStatus, readFigmaExports } from '@decivo/accord-adapter-figma'
import { penStatus, readPenFiles } from '@decivo/accord-adapter-pen'
import { checkChange, type DriftReport, driftReport } from '@decivo/accord-cli'
import {
  type DriftItem,
  type DriftOrigin,
  formatValue,
  LOCK_FILE,
  type Lock,
  parseLock,
  type Register,
} from '@decivo/accord-core'
import { loadRegister } from '@decivo/accord-core/node'
import { type Project, registerDirOf } from './projects'

const TTL_MS = 60_000
const cache = new Map<string, { at: number; value: Promise<HealthData> }>()

export type SurfaceId = 'code' | 'figma' | 'pen' | 'claude-design'

/**
 * Where a difference comes from, in the words the Health screen uses:
 * changed in the tool, in the register, on both sides, deleted in the tool, or unknown (no sync yet).
 */
export type ItemOrigin = 'tool' | 'register' | 'both' | 'deleted' | 'unknown'

export interface SurfaceItem {
  /** Register token path without the `tokens.` prefix. */
  token: string
  origin: ItemOrigin
  breaking: boolean
  before?: string | undefined
  after?: string | undefined
}

/** One workspace (Code, Figma, Pencil, Claude Design) compared with the register and its last sync. */
export interface SurfaceHealth {
  id: SurfaceId
  /** Switched on in `accord.config.yaml`. */
  enabled: boolean
  /** Files Accord read for this surface (Figma exports and `.fig` files, `.pen` files). */
  files: string[]
  /** Last sync recorded in `surfaces.lock.json`. */
  syncedAt?: string | undefined
  /** Register tokens the surface defines and that were compared. */
  compared: number
  inSync: number
  items: SurfaceItem[]
  /** Variables in the tool without a register token. */
  unmapped: string[]
  /** Hard-coded values inside design files (Pencil literals). */
  literals: number
  errors: string[]
  modes: string[]
  /** Figma only: the mode compared with the register, one per collection ("Light"). */
  defaultMode?: string | undefined
  /** Register tokens the tool defines (Figma, Pencil): the ones its sync count is taken over. */
  tokens?: string[] | undefined
  /**
   * Code only: where its file patterns live and what they are, for "no code file scanned", and the
   * stylesheets with its CSS variables (where a missing variable goes).
   */
  config?: { file: string; include: string[]; css?: string[] | undefined } | undefined
}

export interface HealthData {
  report: DriftReport
  /** Contracts whose code file is missing (no counterpart in code). */
  componentsWithoutCode: string[]
  components: number
  surfaces: Record<SurfaceId, SurfaceHealth>
}

const ORIGIN: Record<DriftOrigin, ItemOrigin> = {
  surface: 'tool',
  register: 'register',
  conflict: 'both',
  unknown: 'unknown',
}

const shortPath = (path: string) => path.replace(/^tokens\./, '')

/** Drift items of a variable surface (Figma, Pencil) as Health items, with readable values. */
export function surfaceItems(items: readonly DriftItem[]): SurfaceItem[] {
  return items.map(({ op, origin, classification }) => ({
    token: shortPath(op.path),
    origin: op.kind === 'token.removed' ? 'deleted' : ORIGIN[origin],
    breaking: classification.breaking || op.kind === 'token.removed',
    before:
      op.kind === 'token.value_changed'
        ? formatValue(op.type, op.before)
        : op.kind === 'token.removed'
          ? formatValue(op.before.type, op.before.value)
          : undefined,
    after: op.kind === 'token.value_changed' ? formatValue(op.type, op.after) : undefined,
  }))
}

/** Tokens compared and how many of them match, for a variable surface. */
function syncCounts(tokens: ReadonlyMap<string, unknown>, items: readonly SurfaceItem[]) {
  const changed = new Set(
    items.filter((i) => i.origin !== 'deleted' && tokens.has(i.token)).map((i) => i.token),
  )
  // A token deleted in the tool is no longer in its snapshot, but it is still one that is not in sync.
  const deleted = items.filter((i) => i.origin === 'deleted').length
  return { compared: tokens.size + deleted, inSync: tokens.size - changed.size, tokens: [...tokens.keys()] }
}

const empty = (id: SurfaceId, enabled: boolean, lock: Lock): SurfaceHealth => ({
  id,
  enabled,
  files: [],
  syncedAt: lock.surfaces[id]?.synced_at,
  compared: 0,
  inSync: 0,
  items: [],
  unmapped: [],
  literals: 0,
  errors: [],
  modes: [],
})

async function figmaHealth(project: Project, register: Register, lock: Lock): Promise<SurfaceHealth> {
  const config = register.config.surfaces.figma
  const base = empty('figma', config.enabled, lock)
  try {
    const exports = await readFigmaExports(project.root, config.include)
    const status = figmaStatus(exports, register, lock, { defaultMode: config.default_mode })
    const items = surfaceItems(status.items)
    return {
      ...base,
      files: exports.map((e) => e.path),
      ...syncCounts(status.snapshot.tokens, items),
      items,
      unmapped: status.unmapped.map((v) => v.name),
      errors: status.errors,
      modes: status.modes,
      defaultMode: status.defaultMode,
    }
  } catch (error) {
    return { ...base, errors: [(error as Error).message] }
  }
}

async function penHealth(project: Project, register: Register, lock: Lock): Promise<SurfaceHealth> {
  const config = register.config.surfaces.pen
  const base = empty('pen', config.enabled, lock)
  try {
    const docs = await readPenFiles(project.root, config.include)
    const status = penStatus(docs, register, lock)
    const items = surfaceItems(status.items)
    return {
      ...base,
      files: docs.map((d) => d.path),
      ...syncCounts(status.snapshot.tokens, items),
      items,
      unmapped: status.unmapped.map((v) => v.name),
      literals: status.literals.reduce((n, l) => n + l.count, 0),
      errors: status.errors,
    }
  } catch (error) {
    return { ...base, errors: [(error as Error).message] }
  }
}

function codeHealth(report: DriftReport, register: Register, lock: Lock, configFile: string): SurfaceHealth {
  const { code } = report
  return {
    ...empty('code', register.config.surfaces.code.enabled, lock),
    config: {
      file: configFile,
      include: [...register.config.surfaces.code.include],
      css: [...register.config.surfaces.code.css],
    },
    compared: code.tokensCovered,
    inSync: code.tokensInSync,
    items: code.drift.map((d) => ({
      token: shortPath(d.path),
      origin: d.kind === 'token.removed' ? 'deleted' : ORIGIN[d.origin],
      breaking: d.breaking,
      before: d.register,
      after: d.surface,
    })),
    unmapped: code.unmapped.map((u) => u.name),
  }
}

async function compute(project: Project): Promise<HealthData> {
  const registerDir = registerDirOf(project)
  const [report, register, lockText] = await Promise.all([
    driftReport({ root: project.root, register: registerDir }),
    loadRegister(registerDir),
    readFile(join(registerDir, LOCK_FILE), 'utf8').catch(() => undefined),
  ])
  let lock: Lock
  try {
    lock = parseLock(lockText)
  } catch {
    lock = parseLock(undefined)
  }
  const [figma, pen] = await Promise.all([
    figmaHealth(project, register, lock),
    penHealth(project, register, lock),
  ])
  const surfaces: Record<SurfaceId, SurfaceHealth> = {
    code: codeHealth(
      report,
      register,
      lock,
      relative(project.root, join(registerDir, 'accord.config.yaml')).replaceAll('\\', '/'),
    ),
    figma,
    pen,
    'claude-design': empty('claude-design', register.config.surfaces.claude_design.enabled, lock),
  }
  const componentsWithoutCode: string[] = []
  for (const c of register.components.values()) {
    const path = c.mappings.code?.path
    const exists = path
      ? await access(join(project.root, path)).then(
          () => true,
          () => false,
        )
      : false
    if (!exists) componentsWithoutCode.push(c.name)
  }
  return { report, componentsWithoutCode, components: register.components.size, surfaces }
}

/** Drop a project's cached health, e.g. after a surface was switched on or off. */
export function forgetHealth(slug: string): void {
  cache.delete(slug)
}

/** Drift report for a project, cached for a minute (scanning a large repository takes about a second). */
export function getHealth(project: Project): Promise<HealthData> {
  const hit = cache.get(project.slug)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  const value = compute(project)
  cache.set(project.slug, { at: Date.now(), value })
  value.catch(() => cache.delete(project.slug))
  return value
}

const examples = new Map<string, { at: number; value: Promise<AgentExample> }>()

export interface AgentExample {
  call: string
  /** First lines of the real `check_change` output. */
  output: string[]
}

/** A real `check_change` run on the file with the most hard-coded values, for the "Für Agenten" box. */
export function getAgentExample(project: Project): Promise<AgentExample> {
  const hit = examples.get(project.slug)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  const value = (async () => {
    const { report } = await getHealth(project)
    const counts = new Map<string, number>()
    for (const h of report.code.hardValues) counts.set(h.file, (counts.get(h.file) ?? 0) + 1)
    const file = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (!file) return { call: 'check_change({ paths: [] })', output: [] }
    const result = await checkChange({
      root: project.root,
      registerDir: registerDirOf(project),
      paths: [file],
    })
    // Compact like an agent would read it: per decision the count and the suggested replacements.
    const output: string[] = []
    const byDecision = new Map<string, typeof result.findings>()
    for (const f of result.findings) byDecision.set(f.decision, [...(byDecision.get(f.decision) ?? []), f])
    for (const [id, list] of byDecision) {
      const replacements = [...new Set(list.map((f) => f.replacement).filter((r): r is string => Boolean(r)))]
      output.push(`${list.length} violation(s): ${id}`, `  ${list[0]?.rule ?? ''}`)
      if (replacements.length > 0) output.push(`  replace: ${replacements.slice(0, 3).join(', ')}`)
    }
    return { call: `check_change({\n  paths: ["${file}"]\n})`, output }
  })()
  examples.set(project.slug, { at: Date.now(), value })
  value.catch(() => examples.delete(project.slug))
  return value
}

/** Whether a repository-relative file exists. */
export const fileExists = (root: string, path: string) =>
  access(join(root, path)).then(
    () => true,
    () => false,
  )
