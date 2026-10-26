import type { getFormatter, getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import type { ProjectOverview } from '@/lib/overview-load'
import { decisionHref, projectHref } from '@/lib/routes'

type T = Awaited<ReturnType<typeof getTranslations<'overview'>>>
/** The connections namespace: it holds the one name of each surface state, shared by every screen. */
type TC = Awaited<ReturnType<typeof getTranslations<'connections'>>>
type Format = Awaited<ReturnType<typeof getFormatter>>

/**
 * Code's state in the words every screen uses (Überblick, Projekte, Verbindungen): "Accord prüft deinen
 * Code noch nicht" when code sits in folders Accord does not look in, else "Keine Code-Datei gefunden".
 */
export function noCodeState({ missed }: ProjectOverview, tc: TC): string {
  return missed ? tc('state.notChecked') : tc('state.noFiles', { tool: 'code' })
}

/**
 * The state of a project in one plain sentence, the same on the overview and on the project list. It
 * only says what the one primary step acts on ("5 Entscheidungen warten auf dich."); code files and
 * smaller things are items of their own.
 */
export function overviewSentence(data: ProjectOverview, t: T, tc: TC): string {
  const { overview } = data
  if (!overview) return t('headline.broken')
  const h = overview.headline
  switch (h.kind) {
    case 'decisions':
      return t('headline.decisions', { decisions: h.decisions })
    case 'code':
      return t('headline.code', { state: tc('state.files', { count: h.files }) })
    case 'noCode':
      return t('headline.noCode', { state: noCodeState(data, tc) })
    case 'tasks':
      return t('headline.tasks', { count: h.count })
    default:
      return t('headline.done')
  }
}

/** Without a scanned code file, the plain cause: "Accord sucht Code nur in src/, deiner liegt in app/." */
export function codeOutsideSentence({ missed }: ProjectOverview, t: T, format: Format): ReactNode {
  if (!missed) return undefined
  const dirs = (names: string[]) =>
    format.list(
      names.map((n) => <code key={n}>{`${n}/`}</code>),
      { type: 'conjunction' },
    )
  return t.rich('codeOutside', { found: () => dirs(missed.found), include: () => dirs(missed.include) })
}

/** The folders Accord misses, as the language lists them ("app/ und components/"). */
export function missedFolders({ missed }: ProjectOverview, format: Format): string {
  return format.list(
    (missed?.found ?? []).map((f) => `${f}/`),
    { type: 'conjunction' },
  )
}

/**
 * The project's one action as a link, for the project list: open the decisions, look at the code file
 * with fixed values, connect code, or else open the overview. The list names it with a verb only
 * ("Entscheiden"), since the sentence next to it already says what and how many.
 */
export function stepLink(
  slug: string,
  { overview }: ProjectOverview,
): { href: string; kind: 'decisions' | 'review' | 'connect' | 'overview' } {
  const step = overview?.step
  if (step?.kind === 'decisions') return { href: decisionHref(slug, step.id), kind: 'decisions' }
  if (step?.kind === 'review') return { href: decisionHref(slug, step.id), kind: 'review' }
  if (step?.kind === 'connect') return { href: `${projectHref(slug, 'connections')}#code`, kind: 'connect' }
  return { href: projectHref(slug), kind: 'overview' }
}
