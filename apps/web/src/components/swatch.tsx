import type { CSSProperties } from 'react'
import styles from './swatch.module.css'

/**
 * Colour preview with a checkerboard for transparency. `color` is a CSS colour from the data being
 * shown (a token value, a draft's colour), never a design value of this app.
 */
export function Swatch({
  color,
  size = 'md',
  name,
  value,
}: {
  color: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | undefined
  /** Optional caption: token name. */
  name?: string | undefined
  /** Optional caption: value as text (hex). */
  value?: string | undefined
}) {
  const box = (
    <span
      className={[
        styles.swatch,
        size === 'xs' && styles.xs,
        size === 'sm' && styles.sm,
        size === 'lg' && styles.lg,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ '--swatch': color } as CSSProperties}
      aria-hidden="true"
    />
  )
  if (!name && !value) return box
  return (
    <span className={styles.withLabel}>
      {box}
      <span className={styles.text}>
        {name && <span className={styles.name}>{name}</span>}
        {value && <span className={styles.value}>{value}</span>}
      </span>
    </span>
  )
}
