'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/button'
import { CommandLine } from '@/components/command-line'
import { EmptyState } from '@/components/empty-state'

/**
 * A project Accord cannot read (broken config, unreadable register file). Instead of a bare error page it
 * names the command that shows the reason; the details stay in the terminal, not in the browser.
 */
export default function ProjectError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('projectError')
  return (
    <main id="main" style={{ padding: 'var(--spacing-xl)' }}>
      <EmptyState
        headingLevel={2}
        title={t('title')}
        text={t('text')}
        action={
          <>
            <CommandLine command="accord diff" label={t('copy')} />
            <p style={{ marginTop: 'var(--spacing-md)' }}>
              <Button variant="secondary" onClick={reset}>
                {t('retry')}
              </Button>
            </p>
          </>
        }
      />
    </main>
  )
}
