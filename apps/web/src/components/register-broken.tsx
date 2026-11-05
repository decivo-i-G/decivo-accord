import { getTranslations } from 'next-intl/server'
import type { Project } from '@/lib/projects'
import { CommandLine } from './command-line'
import { EmptyState } from './empty-state'
import styles from './no-register-steps.module.css'
import { Shell } from './shell'

/**
 * A register Accord cannot read (a broken config or token file): every page of the project says so,
 * names what Accord found, and the command that shows it in full. Nothing is decided on a half-read register.
 */
export async function RegisterBroken({ project, problems }: { project: Project; problems: string[] }) {
  const t = await getTranslations('registerBroken')
  return (
    <Shell project={project} active="overview">
      <EmptyState
        headingLevel={2}
        title={t('title')}
        text={t('text')}
        action={
          <div className={styles.steps}>
            {problems.length > 0 && (
              <div>
                <p className={styles.label}>{t('problems')}</p>
                <ul className={styles.problems}>
                  {problems.map((p) => (
                    <li key={p}>
                      <code>{p}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <p className={styles.label}>{t('command')}</p>
              <CommandLine command="accord diff" label={t('copy')} />
            </div>
          </div>
        }
      />
    </Shell>
  )
}
