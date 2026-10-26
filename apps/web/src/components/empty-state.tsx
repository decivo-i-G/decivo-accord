import type { ReactNode } from 'react'
import { BrandDots } from './brand-dots'
import styles from './empty-state.module.css'

/**
 * Empty state as decivo sets it: the four dots, one sentence of title, one of explanation, at most
 * one action. No icon bubble, no dashed box.
 */
export function EmptyState({
  title,
  text,
  action,
  headingLevel = 2,
}: {
  title: string
  text?: ReactNode
  action?: ReactNode
  headingLevel?: 2 | 3 | undefined
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2'
  return (
    <div className={styles.empty}>
      <BrandDots size="md" />
      <Heading className={styles.title}>{title}</Heading>
      {text && <p className={styles.text}>{text}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  )
}
