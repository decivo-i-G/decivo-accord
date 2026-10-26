import { z } from 'zod'
import { type Snapshot, type SnapshotJson, snapshotFromJson, snapshotToJson } from './diff/snapshot.js'

export const LOCK_FILE = 'surfaces.lock.json'

export const SURFACE_IDS = ['code', 'claude-design', 'figma', 'pen'] as const
export type SurfaceId = (typeof SURFACE_IDS)[number]

const LockEntrySchema = z.object({
  synced_at: z.string(),
  /** Register commit the surface was synced to, if known. */
  register_ref: z.string().optional(),
  snapshot: z.custom<SnapshotJson>(
    (v) => typeof v === 'object' && v !== null && 'tokens' in v && 'coverage' in v,
  ),
})

export const LockSchema = z.object({
  version: z.literal(1),
  surfaces: z.partialRecord(z.enum(SURFACE_IDS), LockEntrySchema).default({}),
})

export type Lock = z.infer<typeof LockSchema>

export const emptyLock = (): Lock => ({ version: 1, surfaces: {} })

export function parseLock(content: string | undefined): Lock {
  if (content === undefined) return emptyLock()
  return LockSchema.parse(JSON.parse(content))
}

/** Stable, diff-friendly JSON (sorted keys inside snapshots). */
export const serializeLock = (lock: Lock): string => `${JSON.stringify(lock, null, 2)}\n`

export function lockedSnapshot(lock: Lock, surface: SurfaceId): Snapshot | undefined {
  const entry = lock.surfaces[surface]
  return entry ? snapshotFromJson(entry.snapshot) : undefined
}

/** Record that `surface` now matches `snapshot`. Written only on accept or projection, never on a plain check. */
export function withLockedSnapshot(
  lock: Lock,
  surface: SurfaceId,
  snapshot: Snapshot,
  at: Date,
  registerRef?: string,
): Lock {
  const entry: Lock['surfaces'][SurfaceId] = {
    synced_at: at.toISOString(),
    snapshot: snapshotToJson(snapshot),
  }
  if (registerRef && entry) entry.register_ref = registerRef
  return { ...lock, surfaces: { ...lock.surfaces, [surface]: entry } }
}
