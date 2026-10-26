/**
 * The command palette (⌘K): one search over pages, projects and the current project's proposals,
 * tokens, components and rules, and, when the current project has none of them, the same in the
 * other projects ("In anderen Projekten"). Items are plain data; every one links to an existing deep link
 * (`?id=`, `?token=`, `?component=`, `?rule=`), so the palette adds no state of its own.
 */

export const PALETTE_GROUPS = [
  'pages',
  'proposals',
  'tokens',
  'components',
  'decisions',
  'elsewhere',
  'projects',
] as const
export type PaletteGroup = (typeof PALETTE_GROUPS)[number]

export interface PaletteItem {
  group: PaletteGroup
  /** Unique within the palette (used for the option id). */
  key: string
  label: string
  /** Second line: value, rule, branch, status. */
  detail?: string | undefined
  /** A token's alias, shown before the detail with the interface's arrow icon (never the glyph). */
  alias?: string | undefined
  href: string
  /** CSS colour of a colour token, drawn as a swatch. Data from the register, never a design value. */
  swatch?: string | undefined
  /** Short status text, e.g. "needs you". */
  badge?: string | undefined
  /** Extra words the search matches (lower case), e.g. the CSS variable. */
  keywords?: string | undefined
  /** The label is a value (a token path) and is set in the mono face, as in the register. */
  mono?: boolean | undefined
}

export interface PaletteSection {
  group: PaletteGroup
  items: PaletteItem[]
}

/** How many hits each group shows; the rest are one more letter away. */
const LIMIT: Record<PaletteGroup, number> = {
  pages: 6,
  proposals: 5,
  tokens: 8,
  components: 6,
  decisions: 4,
  elsewhere: 5,
  projects: 5,
}

/** The current project's own content; hits in other projects only show when none of these match. */
const OWN: readonly PaletteGroup[] = ['proposals', 'tokens', 'components', 'decisions']
/** Groups that need a word: without a query they would list the whole register. */
const NEEDS_QUERY: readonly PaletteGroup[] = ['tokens', 'components', 'decisions', 'elsewhere']

const norm = (s: string) => s.toLowerCase()

/**
 * Rank of an item for a query, lower is better; `undefined` when a word does not match.
 * Exact label first, then label prefix, then a word in the label, then anywhere (detail, keywords).
 */
export function rankOf(item: PaletteItem, query: string): number | undefined {
  const words = norm(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return 0
  const label = norm(item.label)
  const hay = `${label} ${norm(item.alias ?? '')} ${norm(item.detail ?? '')} ${item.keywords ?? ''}`
  if (!words.every((w) => hay.includes(w))) return undefined
  const q = words.join(' ')
  if (label === q) return 0
  if (label.startsWith(q)) return 1
  if (label.split(/[\s.\-/·]+/).some((part) => part.startsWith(words[0] ?? ''))) return 2
  if (label.includes(q)) return 3
  return 4
}

/**
 * Hits per group, in the fixed group order. Without a query only pages, open proposals and
 * projects are shown (a starting point, like Linear's palette); tokens and components need a word.
 * Hits in other projects come only when the current project has no proposal, token, component or
 * rule for the query, so "primary" in a project without it still finds `color.primary` next door.
 */
export function searchPalette(items: readonly PaletteItem[], query: string): PaletteSection[] {
  const q = query.trim()
  const sections: PaletteSection[] = []
  for (const group of PALETTE_GROUPS) {
    if (!q && NEEDS_QUERY.includes(group)) continue
    if (group === 'elsewhere' && sections.some((s) => OWN.includes(s.group))) continue
    const hits = items
      .filter((i) => i.group === group)
      .map((item, index) => ({ item, index, rank: rankOf(item, q) }))
      .filter((h): h is { item: PaletteItem; index: number; rank: number } => h.rank !== undefined)
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .slice(0, LIMIT[group])
      .map((h) => h.item)
    if (hits.length > 0) sections.push({ group, items: hits })
  }
  return sections
}
