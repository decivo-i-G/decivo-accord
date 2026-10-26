'use client'

import { useTranslations } from 'next-intl'
import { type InputHTMLAttributes, useEffect, useId, useRef, useState } from 'react'
import { IconButton } from './button'
import { Search, X } from './icons'
import { useShortcutsEnabled } from './inbox-keys'
import { Kbd } from './kbd'
import styles from './search-field.module.css'

/**
 * Search input with a visible (or visually hidden) label, a clear button and the "/" shortcut.
 * Works inside a GET form without JavaScript (`name` defaults to "q"); `onValueChange` lets client
 * lists filter as you type.
 */
export function SearchField({
  label,
  hideLabel = false,
  name = 'q',
  defaultValue = '',
  shortcut: wanted = true,
  onValueChange,
  onKeyDown,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'defaultValue' | 'value' | 'onChange'> & {
  label: string
  hideLabel?: boolean | undefined
  defaultValue?: string | undefined
  /** Focus the field with "/" from anywhere outside another input. */
  shortcut?: boolean | undefined
  onValueChange?: ((value: string) => void) | undefined
}) {
  const t = useTranslations('ui')
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(defaultValue)
  // "/" is a single-key shortcut too: the viewer's "Tastenkürzel" switch turns it off (WCAG 2.1.4).
  const shortcut = useShortcutsEnabled() && wanted

  useEffect(() => {
    if (!shortcut) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      e.preventDefault()
      input.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [shortcut])

  const update = (next: string) => {
    setValue(next)
    onValueChange?.(next)
  }

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={hideLabel ? 'visually-hidden' : styles.label}>
        {label}
      </label>
      <div className={styles.control}>
        <Search aria-hidden="true" className={styles.icon} />
        <input
          ref={input}
          id={id}
          type="search"
          name={name}
          value={value}
          autoComplete="off"
          spellCheck={false}
          className={styles.input}
          aria-keyshortcuts={shortcut ? '/' : undefined}
          onChange={(e) => update(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && value) {
              e.preventDefault()
              update('')
              return
            }
            onKeyDown?.(e)
          }}
          {...rest}
        />
        <span className={styles.end}>
          {value ? (
            <IconButton
              className={styles.clear}
              tooltip="end"
              label={t('clearSearch')}
              icon={<X aria-hidden="true" />}
              onClick={() => {
                update('')
                input.current?.focus()
              }}
            />
          ) : (
            shortcut && (
              <span className={styles.kbd} aria-hidden="true">
                <Kbd>/</Kbd>
              </span>
            )
          )}
        </span>
      </div>
    </div>
  )
}
