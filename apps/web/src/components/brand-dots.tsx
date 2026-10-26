import type { ReactNode } from 'react'
import styles from './brand-dots.module.css'

/**
 * The four dots of the decivo logo: the only ornament (decivo v6). Colours left to right
 * `color.dot.1` to `color.dot.4`; on dark the fourth, darkest dot uses its light variant.
 * Used in the logo, before page titles (`DotTag`), as step markers (`StepDot`), as the loading
 * indicator (`LoadingDots`) and in empty states.
 */
export function BrandDots({
  size = 'sm',
  className,
}: {
  size?: 'sm' | 'md' | undefined
  className?: string
}) {
  return (
    <span aria-hidden="true" className={[styles.dots, styles[size], className].filter(Boolean).join(' ')}>
      <span className={styles.dot} data-dot="1" />
      <span className={styles.dot} data-dot="2" />
      <span className={styles.dot} data-dot="3" />
      <span className={styles.dot} data-dot="4" />
    </span>
  )
}

/**
 * The small line that belongs to a page title: four dots and a short label in normal case, never an
 * uppercase eyebrow. Sits directly above the H1.
 */
export function DotTag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={[styles.tag, className].filter(Boolean).join(' ')}>
      <BrandDots />
      <span>{children}</span>
    </p>
  )
}

/** One dot in the colour of the i-th step (1, 2, 3, 4, then again), like decivo's process steps. */
export function StepDot({ index }: { index: number }) {
  const n = String(((((index - 1) % 4) + 4) % 4) + 1)
  return <span aria-hidden="true" className={`${styles.dot} ${styles.step}`} data-dot={n} />
}

/**
 * Loading indicator: the four dots fill in one after the other. Decorative; the text next to it
 * ("Lädt …", "Wird geschrieben …") says what happens, for screen readers too.
 */
export function LoadingDots() {
  return <BrandDots className={styles.loading} />
}
