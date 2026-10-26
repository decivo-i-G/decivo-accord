import type { Message, ProposalView } from './proposals'

/**
 * Document title, most specific part first: `item · section · project`. The root layout appends
 * "· decivo Accord". A distinct title per selection is what lets screen readers announce client
 * navigation (Next's route announcer reads `document.title`) and keeps tabs and history apart.
 */
export function pageTitle(parts: readonly (string | false | null | undefined)[]): string {
  return parts
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .join(' · ')
}

/**
 * The title part for the selected proposal, the same text its row and breadcrumb show. `undefined`
 * when nothing was picked (`?id=` missing or unknown): then the list itself is the page.
 */
export function proposalItemTitle(
  proposals: readonly Pick<ProposalView, 'id' | 'title'>[],
  id: string | undefined,
  say: (message: Message) => string,
): string | undefined {
  if (!id) return undefined
  const selected = proposals.find((p) => p.id === id)
  return selected ? say(selected.title) : undefined
}
