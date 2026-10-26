import type { Register } from '@decivo/accord-core'
import { previewOf, visibleTokens } from './register-view'

/** How many colours the project row shows, like the thumbnail of a file in Figma's file browser. */
export const PALETTE_SIZE = 10

/** One colour of the strip, with the token it comes from (shown on hover). */
export interface PaletteColour {
  css: string
  hex: string
  name: string
}

/**
 * Up to `size` distinct colours of the register, spread evenly over all of them in register order, so a
 * large system shows its range (not only its first grey ramp): what the system looks like at a glance.
 */
export function paletteOf(register: Pick<Register, 'tokens'>, size = PALETTE_SIZE): PaletteColour[] {
  const seen = new Set<string>()
  const colours: PaletteColour[] = []
  for (const token of visibleTokens(register)) {
    const preview = previewOf(token)
    if (preview.kind !== 'color' || preview.alpha === 0) continue
    const key = preview.hex.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    colours.push({ css: preview.css, hex: key, name: token.path })
  }
  if (colours.length <= size) return colours
  const step = colours.length / size
  return Array.from({ length: size }, (_, i) => colours[Math.floor(i * step)] as PaletteColour)
}

/** What the last change of a project is read from: proposals, decisions and surface syncs. */
export interface ChangeTimes {
  proposals: readonly { createdAt?: string | undefined; decision?: { at?: string | undefined } | undefined }[]
  surfaces?: Readonly<Record<string, { syncedAt?: string | undefined }>> | undefined
}

/**
 * When anything last happened in a project: the newest proposal, decision or surface sync, like the
 * "updated 5 days ago" of a repository list. Undefined when nothing carries a valid date.
 */
export function lastChangeOf({ proposals, surfaces }: ChangeTimes): Date | undefined {
  const times = [
    ...proposals.flatMap((p) => [p.createdAt, p.decision?.at]),
    ...Object.values(surfaces ?? {}).map((s) => s.syncedAt),
  ]
    .map((at) => (at ? Date.parse(at) : Number.NaN))
    .filter((ms) => Number.isFinite(ms))
  return times.length > 0 ? new Date(Math.max(...times)) : undefined
}
