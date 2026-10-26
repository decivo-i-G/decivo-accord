import type { ReactNode } from 'react'
import styles from './badge.module.css'
import { CircleAlert, CircleCheck, CircleDot, Info, TriangleAlert } from './icons'

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'

const DEFAULT_ICON: Record<Tone, ReactNode> = {
  neutral: <CircleDot aria-hidden="true" />,
  brand: <CircleDot aria-hidden="true" />,
  success: <CircleCheck aria-hidden="true" />,
  warning: <TriangleAlert aria-hidden="true" />,
  danger: <CircleAlert aria-hidden="true" />,
  info: <Info aria-hidden="true" />,
}

/**
 * Status as icon plus text, never colour alone. `icon={null}` hides the icon for purely
 * descriptive labels (e.g. "must"), where the text carries everything.
 */
export function StatusChip({
  tone = 'neutral',
  solid = false,
  icon,
  children,
}: {
  tone?: Tone | undefined
  solid?: boolean | undefined
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <span className={[styles.chip, styles[tone], solid && styles.solid].filter(Boolean).join(' ')}>
      {icon === undefined ? DEFAULT_ICON[tone] : icon}
      {children}
    </span>
  )
}

/**
 * A small count (e.g. open proposals in the sidebar). `label` is the full sentence for screen
 * readers ("3 open"); the number alone is shown.
 */
export function CountBadge({
  count,
  label,
  tone = 'neutral',
}: {
  count: number
  label: string
  tone?: 'neutral' | 'brand' | undefined
}) {
  return (
    <span className={`${styles.count} ${tone === 'brand' ? styles.countBrand : styles.countNeutral}`}>
      <span aria-hidden="true">{count}</span>
      <span className="visually-hidden">{label}</span>
    </span>
  )
}
