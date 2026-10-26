import { type ChangeOp, type Classification, classify, diffSnapshots, opKey } from './diff.js'
import type { Snapshot } from './snapshot.js'

/**
 * Where a difference between register and surface comes from, judged against the last synced state (lock):
 * - `surface`: the surface changed since the last sync → becomes a proposal to the register.
 * - `register`: the register changed and the surface was not updated yet → needs a projection.
 * - `conflict`: both changed the same thing differently → a human decides.
 * - `unknown`: no lock entry yet (first run), so the direction cannot be known.
 */
export type DriftOrigin = 'surface' | 'register' | 'conflict' | 'unknown'

export interface DriftItem {
  /** What the surface has, relative to the register (applying `op` to the register yields the surface). */
  op: ChangeOp
  origin: DriftOrigin
  classification: Classification
}

export interface ThreeWayInput {
  /** Last synced state of this surface, from `surfaces.lock.json`. */
  base?: Snapshot | undefined
  register: Snapshot
  surface: Snapshot
}

export function threeWayDiff({ base, register, surface }: ThreeWayInput): DriftItem[] {
  const drift = diffSnapshots(register, surface)
  if (!base) return drift.map((op) => ({ op, origin: 'unknown', classification: classify(op) }))

  const surfaceChanged = new Set(diffSnapshots(base, surface).map(opKey))
  const registerChanged = new Set(diffSnapshots(base, register).map(opKey))

  return drift.map((op) => {
    const key = opKey(op)
    const bySurface = surfaceChanged.has(key)
    const byRegister = registerChanged.has(key)
    const origin: DriftOrigin =
      bySurface && byRegister ? 'conflict' : bySurface ? 'surface' : byRegister ? 'register' : 'unknown'
    return { op, origin, classification: classify(op) }
  })
}
