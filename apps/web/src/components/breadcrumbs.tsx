import Link from 'next/link'
import styles from './breadcrumbs.module.css'

export interface Crumb {
  label: string
  href?: string | undefined
  /**
   * The project crumb. On phones it is left out: the project switcher in the top bar already names
   * the project, so the path starts at the section.
   */
  project?: boolean | undefined
  /** The label is a value (a token path): set in mono, as in the register's list and title. */
  code?: boolean | undefined
}

/**
 * `project / section / item`. The last crumb is the current page. `phone` keeps the path on phones,
 * where the page's H1 already names a section; below a section (an item) it leads back up.
 */
export function Breadcrumbs({
  label,
  items,
  phone = true,
}: {
  label: string
  items: Crumb[]
  phone?: boolean | undefined
}) {
  return (
    <nav aria-label={label} className={`${styles.crumbs} ${phone ? '' : styles.desktopOnly}`}>
      <ol className={styles.list}>
        {items.map((item, i) => {
          const last = i === items.length - 1
          return (
            <li
              key={`${item.label}|${item.href ?? ''}`}
              className={`${styles.item} ${item.project ? styles.project : ''}`}
            >
              {i > 0 && (
                <span className={styles.sep} aria-hidden="true">
                  /
                </span>
              )}
              {last || !item.href ? (
                <span
                  className={`${last ? styles.current : styles.plain} ${item.code ? styles.code : ''}`}
                  aria-current={last ? 'page' : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <Link className={`${styles.link} ${item.code ? styles.code : ''}`} href={item.href}>
                  {item.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
