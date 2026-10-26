import type { Tone } from '@/components/status-chip'

/**
 * The one state of a surface, the same on Home, Health and Connections:
 * - `connected`: switched on and Accord found something to compare;
 * - `noFiles`: switched on, but nothing found (or, for code, no file scanned);
 * - `foundOff`: Accord found files or handoffs, but the comparison is switched off;
 * - `off`: neither switched on nor found.
 * Code is always on. Claude Design is connected through handoffs: once a handoff is read in it is part of
 * proposals and health, so it counts as connected whether or not its design-system project is compared.
 */
export type SurfaceStateId = 'connected' | 'noFiles' | 'foundOff' | 'off'

export interface SurfaceStateInput {
  enabled: boolean
  /** Files (Figma, Pencil), scanned code files, or handoffs (Claude Design). */
  found: number
  /** What was found are handoffs (Claude Design): they arrive without switching anything on. */
  handoffs?: boolean | undefined
}

export interface SurfaceState {
  id: SurfaceStateId
  tone: Tone
}

const TONE: Record<SurfaceStateId, Tone> = {
  connected: 'success',
  noFiles: 'warning',
  foundOff: 'info',
  off: 'neutral',
}

export function surfaceState({ enabled, found, handoffs = false }: SurfaceStateInput): SurfaceState {
  const id: SurfaceStateId =
    enabled || (handoffs && found > 0)
      ? found > 0
        ? 'connected'
        : 'noFiles'
      : found > 0
        ? 'foundOff'
        : 'off'
  return { id, tone: TONE[id] }
}
