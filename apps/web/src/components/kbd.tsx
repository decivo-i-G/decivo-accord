import type { ReactNode } from 'react'
import styles from './kbd.module.css'

/** A keyboard key, e.g. <Kbd>J</Kbd>. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={styles.kbd}>{children}</kbd>
}

/**
 * A shortcut hint: keys plus what they do ("J K Move"). Hidden on touch devices, where there is no
 * keyboard; the action itself is always reachable without the shortcut.
 */
export function KbdHint({ keys, children }: { keys: string[]; children: ReactNode }) {
  return (
    <span className={`${styles.hint} ${styles.hideOnTouch}`}>
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
      <span>{children}</span>
    </span>
  )
}
