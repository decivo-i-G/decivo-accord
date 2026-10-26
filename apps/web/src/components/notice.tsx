import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, CircleDot, Info, TriangleAlert } from './icons'
import styles from './notice.module.css'
import type { Tone } from './status-chip'

const ICON: Record<Tone, ReactNode> = {
  neutral: <CircleDot aria-hidden="true" />,
  brand: <Info aria-hidden="true" />,
  success: <CircleCheck aria-hidden="true" />,
  warning: <TriangleAlert aria-hidden="true" />,
  danger: <CircleAlert aria-hidden="true" />,
  info: <Info aria-hidden="true" />,
}

/** A sentence-long message in a tinted box with an icon (outcome of a decision, a warning). */
export function Notice({
  tone = 'info',
  title,
  icon,
  role,
  children,
}: {
  tone?: Tone | undefined
  title?: string | undefined
  icon?: ReactNode
  /** "status" for outcomes that appear after an action. */
  role?: 'status' | 'alert' | undefined
  children?: ReactNode
}) {
  return (
    <div className={`${styles.notice} ${styles[tone]}`} role={role}>
      {icon ?? ICON[tone]}
      <div className={styles.body}>
        {title && <p className={styles.title}>{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  )
}
