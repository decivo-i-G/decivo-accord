import { loadRegister } from '@decivo/accord-core/node'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { cache } from 'react'
import { pageTitle, proposalItemTitle } from './page-title'
import { findProject, registerDirOf } from './projects'
import { loadProjectInbox, type Message } from './proposals'
import { readRegisterState } from './register-href'
import { visibleTokens } from './register-view'
import type { ProjectPage } from './routes'

/**
 * `generateMetadata` for the project pages: `item · section · project · decivo Accord`, built from
 * the same values as the breadcrumbs, so every selection has its own title.
 */

type Search = Record<string, string | string[] | undefined>
export interface PageProps {
  params: Promise<{ project: string }>
  searchParams: Promise<Search>
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined

/** The register, read once per request (metadata and page both need it). */
export const loadRegisterOnce = cache((dir: string) => loadRegister(dir))

async function titled(slug: string, section: ProjectPage, item?: string | undefined): Promise<Metadata> {
  const project = findProject(slug)
  const t = await getTranslations('nav')
  return { title: pageTitle([item, t(section), project?.name ?? slug]) }
}

export async function decisionsMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { project: slug } = await params
  const id = one((await searchParams).id)
  const project = findProject(slug)
  if (!project || !id) return titled(slug, 'decisions')
  const tp = await getTranslations('proposals')
  const say = (m: Message) => tp(m.key as Parameters<typeof tp>[0], m.values as never)
  const { proposals } = await loadProjectInbox(project)
  return titled(slug, 'decisions', proposalItemTitle(proposals, id, say))
}

export async function registerMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { project: slug } = await params
  const state = readRegisterState(await searchParams)
  const project = findProject(slug)
  const t = await getTranslations('register')
  let item: string | undefined
  if (project && state.item) {
    const register = await loadRegisterOnce(registerDirOf(project)).catch(() => undefined)
    if (register) {
      if (state.tab === 'tokens') {
        const token = register.tokens.get(state.item)
        item = token && visibleTokens(register).includes(token) ? token.path : undefined
      } else if (state.tab === 'components') {
        item = register.components.get(state.item)?.name
      } else {
        const decision = register.decisions.get(state.item)
        item = decision?.status === 'active' ? decision.rule : undefined
      }
    }
  }
  return titled(slug, 'register', item ?? t(`tabs.${state.tab}`))
}

export async function overviewMetadata({ params }: Pick<PageProps, 'params'>): Promise<Metadata> {
  return titled((await params).project, 'overview')
}

export async function connectionsMetadata({ params }: Pick<PageProps, 'params'>): Promise<Metadata> {
  return titled((await params).project, 'connections')
}
