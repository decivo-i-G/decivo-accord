'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { startTransition } from 'react'
import { useFormStatus } from 'react-dom'
import { excludeCode, includeCode } from '@/app/actions'
import { Button } from './button'
import { ArrowRight } from './icons'
import styles from './include-code-button.module.css'
import { useToast } from './toast'

function Submit({
  label,
  className,
  variant,
}: {
  label: string
  className?: string | undefined
  variant: 'primary' | 'secondary'
}) {
  const t = useTranslations('overview.step')
  const { pending } = useFormStatus()
  // A quiet look (the project list's link style) for places where it is not the screen's primary.
  if (className)
    return (
      <button type="submit" className={className} disabled={pending}>
        {pending ? t('including') : label}
        <ArrowRight aria-hidden="true" />
      </button>
    )
  return (
    <Button type="submit" variant={variant} iconAfter={<ArrowRight aria-hidden="true" />} disabled={pending}>
      {pending ? t('including') : label}
    </Button>
  )
}

/**
 * The one action when code sits in folders Accord does not look in (overview and the Code row on
 * Connections): one click adds them to `surfaces.code.include`, so a designer can finish "Code
 * verbinden" without editing YAML. The folders are worked out on the server; the form only names the
 * project. A toast names the folders and the new number of checked files, with an undo that takes the
 * folders out again (like the surface switch). `note` says before the click what it will change.
 */
export function IncludeCodeButton({
  project,
  label,
  configFile,
  className,
  variant = 'primary',
  note,
}: {
  project: string
  /** "app/ und components/ prüfen". */
  label: string
  /** One sentence under the button: what the click writes and that it can be undone. */
  note?: string | undefined
  configFile: string
  /** A quiet class instead of the primary button (the project list). */
  className?: string | undefined
  /** Secondary where the screen's step is something else (Connections, a settings page). */
  variant?: 'primary' | 'secondary' | undefined
}) {
  const t = useTranslations('overview.step')
  const format = useFormatter()
  const { show } = useToast()
  const run = async (data: FormData) => {
    try {
      const { folders, files } = await includeCode(data)
      if (folders.length === 0) return
      const names = format.list(
        folders.map((f) => `${f}/`),
        { type: 'conjunction' },
      )
      const undo = new FormData()
      undo.set('project', project)
      for (const f of folders) undo.append('folder', f)
      show({
        message: t('included', { folders: names, files }),
        tone: 'success',
        action: {
          label: t('undo'),
          onClick: () =>
            startTransition(async () => {
              const removed = await excludeCode(undo).catch(() => undefined)
              show(
                removed
                  ? { message: t('undone', { folders: names }), tone: 'info' }
                  : { message: t('includeFailed', { file: configFile }), tone: 'danger' },
              )
            }),
        },
      })
    } catch {
      show({ message: t('includeFailed', { file: configFile }), tone: 'danger' })
    }
  }
  return (
    <form action={run} className={note ? styles.withNote : undefined}>
      <input type="hidden" name="project" value={project} />
      <Submit label={label} className={className} variant={variant} />
      {note && <p className={styles.note}>{note}</p>}
    </form>
  )
}
