/**
 * The project's addresses in one place. Three sections (Überblick, Entscheidungen, Register) and the
 * project settings (Verbindungen), which are reached from the gear at the project switcher, not from
 * the main navigation. The overview is the project start itself: `/p/acme`.
 */

export type Section = 'overview' | 'decisions' | 'register'
/** Every page of a project: the three sections and the settings. */
export type ProjectPage = Section | 'connections'

/** The order of the sections in the sidebar and the tab bar: see, decide, look up. */
export const SECTIONS: readonly Section[] = ['overview', 'decisions', 'register']

export function projectHref(slug: string, page: ProjectPage = 'overview'): string {
  const base = `/p/${encodeURIComponent(slug)}`
  return page === 'overview' ? base : `${base}/${page}`
}

/** The surfaces a decision comes from, as the inbox filter `?source=` names them (Pencil is `pen`). */
export const DECISION_SOURCES = ['code', 'figma', 'pen', 'claude-design'] as const
export type DecisionSource = (typeof DECISION_SOURCES)[number]

/** The `?source=` value if it names a surface; anything else means no filter. */
export function decisionSourceOf(value: unknown): DecisionSource | undefined {
  return DECISION_SOURCES.find((s) => s === value)
}

/** The inbox, optionally showing only the decisions from one surface. */
export const decisionsHref = (slug: string, source?: DecisionSource) =>
  source ? `${projectHref(slug, 'decisions')}?source=${source}` : projectHref(slug, 'decisions')

/** One decision opened in an inbox address, keeping its filter. */
export const withDecision = (inbox: string, id: string) =>
  `${inbox}${inbox.includes('?') ? '&' : '?'}id=${encodeURIComponent(id)}`

/** A deep link to one open decision in the inbox. */
export const decisionHref = (slug: string, id: string) => withDecision(decisionsHref(slug), id)

/**
 * Addresses from before the three sections, kept working: Systemzustand became the overview, and the
 * inbox "Vorschläge" became "Entscheidungen". Next keeps the query string (`?id=`, `?surface=`), so an
 * old deep link still opens the same decision.
 */
export const LEGACY_REDIRECTS = [
  { source: '/p/:project/health', destination: '/p/:project', permanent: true },
  { source: '/p/:project/proposals', destination: '/p/:project/decisions', permanent: true },
  // The gear is the project settings; today they hold the connections, so a guessed address lands there.
  { source: '/p/:project/settings', destination: '/p/:project/connections', permanent: false },
] as const
