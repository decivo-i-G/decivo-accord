import type { ReactNode } from 'react'
import { IconLink } from './button'
import { ArrowLeft } from './icons'
import styles from './panel.module.css'
import { FocusOnOpen } from './panel-focus'

/**
 * Main area with a docked inspector on the right. Use inside `<Shell flush>`.
 * `open` says whether an item was chosen explicitly (e.g. `?id=` in the URL): on narrow screens the
 * inspector then replaces the list as a full page; otherwise the list shows. Wide screens show both.
 */
export function PanelLayout({
  children,
  inspector,
  open,
  wide = false,
  heading,
}: {
  children: ReactNode
  inspector?: ReactNode
  open: boolean
  /** A wider inspector for rich details (before/after previews). */
  wide?: boolean | undefined
  /**
   * The page's title. On narrow screens with the inspector open the list (and its H1) is hidden;
   * this keeps an H1 for screen readers' heading navigation.
   */
  heading?: string | undefined
}) {
  return (
    <div
      className={`${styles.layout} ${wide ? styles.wide : ''}`}
      data-open={inspector ? String(open) : undefined}
    >
      {heading && inspector && open && <h1 className={`visually-hidden ${styles.pageHeading}`}>{heading}</h1>}
      <div className={styles.grid}>
        <div className={styles.main} data-panel-main>
          {children}
        </div>
        {inspector}
      </div>
    </div>
  )
}

/** The inspector: title, an optional meta line under it, body and a sticky footer for the one primary action. */
export function Inspector({
  label,
  meta,
  title,
  backHref,
  backLabel,
  headerAction,
  footer,
  titleFont = 'heading',
  heading,
  children,
}: {
  /** Accessible name of the region, e.g. "Details zum Vorschlag". */
  label: string
  /** One quiet line under the title (type, source, time); never an uppercase label above it. */
  meta?: ReactNode
  title: string
  /** The title as rendered, when parts of it are set in mono (token names); `title` stays its text. */
  heading?: ReactNode
  /** Where "back" goes on narrow screens (the list without selection). */
  backHref: string
  backLabel: string
  headerAction?: ReactNode
  footer?: ReactNode
  /** `mono` for a title that is a token path or code name (`color.brand`): set like the list names it. */
  titleFont?: 'heading' | 'mono' | undefined
  children: ReactNode
}) {
  return (
    <aside className={styles.inspector} aria-label={label} data-inspector>
      <FocusOnOpen title={title} />
      <div className={styles.inspectorInner}>
        <div className={styles.head}>
          <IconLink
            href={backHref}
            label={backLabel}
            icon={<ArrowLeft aria-hidden="true" />}
            className={styles.back}
            tooltip="start"
            scroll={false}
          />
          <div className={styles.headText}>
            {/* Focus lands here after a decision or when the inspector opens as a page (never on <body>). */}
            <h2
              id="inspector-title"
              className={`${styles.title} ${titleFont === 'mono' ? styles.titleMono : ''}`}
              tabIndex={-1}
            >
              {heading ?? title}
            </h2>
            {meta && <div className={styles.meta}>{meta}</div>}
          </div>
          {headerAction}
        </div>
        <div className={styles.body}>{children}</div>
        {footer && (
          <div className={styles.footer} data-inspector-footer>
            {footer}
          </div>
        )}
      </div>
    </aside>
  )
}

/** A titled group inside the inspector. */
export function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  )
}

/** Label/value rows (a `<dl>`), Figma-properties style. */
export function PropertyList({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className={styles.rows}>
      {rows.map((r) => (
        <div key={r.label} className={styles.row}>
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}
