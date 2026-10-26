import Link from 'next/link'
import type { ReactNode } from 'react'
import { CountBadge } from './status-chip'
import styles from './tabs.module.css'

export interface TabItem {
  id: string
  label: string
  href: string
  icon?: ReactNode
  /** Optional count with its screen-reader sentence. */
  count?: { value: number; label: string } | undefined
}

/**
 * Navigation tabs: each tab is a link that changes the URL (shareable, works without JavaScript).
 * `underline` for sections of a page (Figma panel tabs), `segmented` for filters.
 */
export function Tabs({
  label,
  items,
  current,
  variant = 'underline',
  scroll = false,
}: {
  label: string
  items: TabItem[]
  current: string
  variant?: 'underline' | 'segmented' | undefined
  /**
   * Keep a segmented filter on one line on phones and let it scroll sideways (the cut-off segment at
   * the edge shows there is more), instead of wrapping one segment onto a line of its own.
   */
  scroll?: boolean | undefined
}) {
  const kind = variant === 'segmented' ? styles.segmented : styles.underline
  return (
    <nav aria-label={label} className={scroll ? styles.scrollNav : undefined}>
      <ul className={[styles.list, kind, scroll && styles.scroll].filter(Boolean).join(' ')}>
        {items.map((item) => (
          <li key={item.id}>
            <Link
              className={styles.tab}
              href={item.href}
              aria-current={item.id === current ? 'page' : undefined}
              scroll={false}
            >
              {item.icon}
              {item.label}
              {item.count && <CountBadge count={item.count.value} label={item.count.label} />}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
