import type { ReactNode } from 'react'
import { BrandDots, DotTag } from './brand-dots'
import styles from './page-header.module.css'

/**
 * Page title as decivo v6 sets it: the four dots directly above the H1 in Merriweather 300, one
 * sentence of lead, an optional meta line and actions on the right. Every page title has the same
 * size, so moving between sections does not make the type jump. Project pages leave out the label
 * next to the dots: the switcher and the breadcrumb already name the project. Pages outside a project
 * (the project list) give a short label (`tag`).
 */
export function PageHeader({
  title,
  tag,
  lead,
  leadClassName,
  meta,
  actions,
  compact = false,
  children,
}: {
  title: string
  /** The words next to the four dots, on pages outside a project. */
  tag?: string | undefined
  lead?: string | undefined
  /** Extra class for the lead, e.g. to drop it on phones where the page's first answer must come first. */
  leadClassName?: string | undefined
  meta?: ReactNode
  actions?: ReactNode
  /**
   * Working screens (the inbox): the meta line on the same row as the title, so the list starts
   * right under it.
   */
  compact?: boolean | undefined
  children?: ReactNode
}) {
  return (
    <header className={`${styles.header} ${compact ? styles.compact : ''}`}>
      <div className={styles.text}>
        {tag ? (
          <DotTag className={styles.tag}>{tag}</DotTag>
        ) : (
          <BrandDots className={`${styles.tag} ${styles.dots}`} />
        )}
        {compact ? (
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{title}</h1>
            {meta && <div className={styles.meta}>{meta}</div>}
          </div>
        ) : (
          <h1 className={styles.title}>{title}</h1>
        )}
        {lead && <p className={leadClassName ? `${styles.lead} ${leadClassName}` : styles.lead}>{lead}</p>}
        {meta && !compact && <div className={styles.meta}>{meta}</div>}
        {children}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  )
}
