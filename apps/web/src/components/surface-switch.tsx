'use client'

import { useTranslations } from 'next-intl'
import { startTransition, useOptimistic } from 'react'
import { toggleTool } from '@/app/actions'
import type { ToolId } from '@/lib/connections'
import { Button } from './button'
import styles from './surface-switch.module.css'
import { useToast } from './toast'

function formData(project: string, tool: ToolId, enabled: boolean) {
  const data = new FormData()
  data.set('project', project)
  data.set('tool', tool)
  data.set('enabled', String(enabled))
  return data
}

/**
 * Switches a surface on or off in `accord.config.yaml`. The switch flips at once and a toast confirms the
 * change with an undo. It is only rendered where it can change something: a surface that is always
 * compared, or has nothing to compare yet, has no switch at all, never an inert one. `variant="button"` is the same
 * action as a primary button, for the "next step" of a surface that was found but is off.
 */
export function SurfaceSwitch({
  project,
  tool,
  name,
  enabled,
  configFile,
  variant = 'switch',
  describedBy,
}: {
  project: string
  tool: ToolId
  /** The surface's name as shown, e.g. "Figma". */
  name: string
  enabled: boolean
  configFile: string
  variant?: 'switch' | 'button' | undefined
  /** The id of the sentence that says why it is off, or what it does. */
  describedBy?: string | undefined
}) {
  const t = useTranslations('connections.switch')
  const { show } = useToast()
  const [on, setOn] = useOptimistic(enabled)
  // Claude Design's handoffs arrive whether or not it is switched on: its switch only covers the
  // design-system project. It sits under "For developers", named for that project.
  const isProjectSync = tool === 'claude_design'

  const run = async (next: boolean) => {
    setOn(next)
    try {
      await toggleTool(formData(project, tool, next))
    } catch {
      show({ message: t('failed', { file: configFile }), tone: 'danger' })
      return
    }
    show({
      message: isProjectSync
        ? t(next ? 'projectOnToast' : 'projectOffToast')
        : next
          ? t('on', { tool: name })
          : t('off', { tool: name }),
      tone: next ? 'success' : 'info',
      action: {
        label: t('undo'),
        onClick: () => startTransition(() => toggleTool(formData(project, tool, !next))),
      },
    })
  }

  if (variant === 'button')
    return (
      <form action={() => run(true)}>
        <Button type="submit" variant="primary">
          {t('enable', { tool: name })}
        </Button>
      </form>
    )

  return (
    <form action={() => run(!on)} className={styles.form}>
      <button
        type="submit"
        role="switch"
        aria-checked={on}
        aria-describedby={describedBy}
        className={`${styles.switch} ${isProjectSync ? '' : styles.labelled}`}
      >
        {/*
         * In a surface's row the switch says what it does ("Mit dem Register vergleichen"), the hidden
         * part names the surface for screen readers. role=switch and aria-checked carry the state and
         * the track shows it, so no "On"/"Off" text repeats it. Under "For developers" the setting's
         * label sits beside it, so there the name stays hidden.
         */}
        {isProjectSync ? (
          <span className="visually-hidden">{t('projectName')}</span>
        ) : (
          <>
            <span className={styles.label}>{t('label')}</span>
            <span className="visually-hidden">{` (${name})`}</span>
          </>
        )}
        <span className={styles.track} aria-hidden="true">
          <span className={styles.thumb} />
        </span>
      </button>
    </form>
  )
}
