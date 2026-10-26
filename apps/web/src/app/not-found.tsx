import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { ButtonLink } from '@/components/button'
import { ArrowRight, GitBranch } from '@/components/icons'
import { PageHeader } from '@/components/page-header'
import { Shell } from '@/components/shell'
import { listProjects } from '@/lib/projects'
import { projectHref } from '@/lib/routes'
import styles from './not-found.module.css'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('notFound'))('title') }
}

/**
 * Any unknown address (a mistyped project, an old link) inside the app frame, in the user's
 * language: what happened, the projects that do exist, and the way back to the overview.
 */
export default async function NotFound() {
  const t = await getTranslations('notFound')
  const projects = listProjects()
  return (
    <Shell>
      <PageHeader tag={t('tag')} title={t('title')} lead={projects.length > 0 ? t('lead') : t('none')} />
      {projects.length > 0 && (
        <ul className={styles.list} aria-label={t('projects')}>
          {projects.map((p) => (
            <li key={p.slug}>
              <Link href={projectHref(p.slug)} className={styles.link}>
                <span className={styles.name}>{p.name}</span>
                <span className={styles.branch}>
                  <GitBranch aria-hidden="true" />
                  {p.branch}
                </span>
                <ArrowRight aria-hidden="true" className={styles.arrow} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div>
        <ButtonLink href="/" variant="primary">
          {t('home')}
        </ButtonLink>
      </div>
    </Shell>
  )
}
