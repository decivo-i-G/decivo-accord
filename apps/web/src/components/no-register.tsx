import { getTranslations } from 'next-intl/server'
import type { Project } from '@/lib/projects'
import { CommandLine } from './command-line'
import { EmptyState } from './empty-state'
import styles from './no-register-steps.module.css'
import { Shell } from './shell'

/**
 * A project without a register: every page of it says the same thing and the two commands that
 * change it. `accord init --dry-run` first, so nobody writes into a repository blindly.
 */
export async function NoRegister({ project }: { project: Project }) {
  const t = await getTranslations('noRegister')
  return (
    <Shell project={project} active="overview">
      <EmptyState
        headingLevel={2}
        title={t('title')}
        text={t('text')}
        action={
          <ol className={styles.steps}>
            <li>
              <p className={styles.label}>{t('preview')}</p>
              <CommandLine command="accord init --dry-run" label={t('copy')} />
            </li>
            <li>
              <p className={styles.label}>{t('create')}</p>
              <CommandLine command="accord init" label={t('copy')} />
            </li>
          </ol>
        }
      />
    </Shell>
  )
}
