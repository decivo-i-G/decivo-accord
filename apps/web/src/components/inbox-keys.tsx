'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { withDecision } from '@/lib/routes'
import { Button, IconButton } from './button'
import { Keyboard, X } from './icons'
import { Kbd } from './kbd'
import styles from './shortcut-sheet.module.css'
import switchStyles from './surface-switch.module.css'

const ACTIONS: Record<string, string> = { a: 'decide-adopt', r: 'decide-reset', x: 'decide-reject' }

const typing = (target: EventTarget | null) => {
  const el = target as HTMLElement | null
  return Boolean(el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)))
}

// --- Shortcuts on or off (per viewer, WCAG 2.1.4) ------------------------------------------------

const STORAGE_KEY = 'accord.shortcuts'
const CHANGED = 'accord:shortcuts'

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(CHANGED, onChange)
    window.removeEventListener('storage', onChange)
  }
}

/** Whether single-key shortcuts are on for this viewer (on unless switched off). */
export function useShortcutsEnabled(): boolean {
  return useSyncExternalStore(subscribe, readEnabled, () => true)
}

function setEnabled(on: boolean) {
  try {
    if (on) window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, 'off')
  } catch {
    // Storage blocked (private window): the switch still works for this page view.
  }
  window.dispatchEvent(new Event(CHANGED))
}

/** A switch that turns the single-key shortcuts off, e.g. for speech input. */
function ShortcutToggle({ hint }: { hint: string }) {
  const t = useTranslations('proposals')
  const on = useShortcutsEnabled()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-describedby="shortcut-hint"
      className={switchStyles.switch}
      onClick={() => setEnabled(!on)}
    >
      <span>{t('keys.toggle')}</span>
      <span className={switchStyles.track} aria-hidden="true">
        <span className={switchStyles.thumb} />
      </span>
      <span id="shortcut-hint" className="visually-hidden">
        {hint}
      </span>
    </button>
  )
}

// --- The shortcut sheet ("?") ----------------------------------------------------------------------

const OPEN_SHEET = 'accord:shortcut-sheet'

/** Opens the page's shortcut sheet ("?"). */
export function openShortcutSheet() {
  window.dispatchEvent(new Event(OPEN_SHEET))
}

/**
 * The shortcuts of a list screen, out of the header: "?" (and, in the inbox, a quiet "Keyboard
 * shortcuts" button under the list) opens a sheet (native modal dialog) that lists them and holds the
 * switch that turns them off. The register has its own keys and no button: one control less.
 */
export function ShortcutSheet({ screen = 'inbox' }: { screen?: 'inbox' | 'register' | undefined }) {
  const t = useTranslations('proposals')
  const tr = useTranslations('register')
  const dialog = useRef<HTMLDialogElement>(null)
  const show = useCallback(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
  }, [])
  useEffect(() => {
    window.addEventListener(OPEN_SHEET, show)
    return () => window.removeEventListener(OPEN_SHEET, show)
  }, [show])
  const keys: [string[], string][] =
    screen === 'register'
      ? [
          [['J', 'K'], tr('keys.move')],
          [['C'], tr('keys.copy')],
          [[tr('keys.esc')], tr('keys.close')],
          [['/'], t('keys.search')],
          [['?'], t('keys.help')],
        ]
      : [
          [[t('keys.enter')], t('keys.recommended')],
          [['J', 'K'], t('keys.move')],
          [['A'], t('keys.adopt')],
          [['R'], t('keys.reset')],
          [['X'], t('keys.reject')],
          [['/'], t('keys.search')],
          [['?'], t('keys.help')],
        ]
  return (
    <>
      {screen === 'inbox' && (
        <Button
          variant="quiet"
          className={styles.trigger}
          icon={<Keyboard aria-hidden="true" />}
          aria-haspopup="dialog"
          aria-keyshortcuts="?"
          onClick={show}
        >
          {t('keys.open')}
          <Kbd>?</Kbd>
        </Button>
      )}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click only; Escape closes the dialog natively */}
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby="shortcut-title"
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close()
        }}
      >
        <div className={styles.head}>
          <h2 id="shortcut-title" className={styles.title}>
            {t('keys.title')}
          </h2>
          <IconButton
            label={t('keys.close')}
            icon={<X aria-hidden="true" />}
            tooltip="end"
            onClick={() => dialog.current?.close()}
          />
        </div>
        <dl className={styles.list}>
          {keys.map(([k, text]) => (
            <div key={k.join()} className={styles.item}>
              <dt className={styles.keys}>
                {k.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </dt>
              <dd className={styles.text}>{text}</dd>
            </div>
          ))}
        </dl>
        <div className={styles.foot}>
          <ShortcutToggle hint={screen === 'register' ? tr('keys.toggleHint') : t('keys.toggleHint')} />
        </div>
      </dialog>
    </>
  )
}

// --- Focus after a decision ----------------------------------------------------------------------

/** When a decision or an undo asked to focus the next title (stale after a few seconds). */
let focusTitleAt = 0

/** After the next change of selection (a decision moved on, an undo came back), focus its title. */
export function focusTitleAfterNavigation() {
  focusTitleAt = Date.now()
}

/** Focus the inspector's title (or the main area when there is none), so focus never falls to <body>. */
export function focusInspectorTitle() {
  const title = document.getElementById('inspector-title')
  if (title && title.offsetParent !== null) title.focus({ preventScroll: false })
  else document.getElementById('main')?.focus()
}

/**
 * Inbox shortcuts like in Linear or Gmail: J/K move through the list, A/R/X press the visible
 * Adopt/Reset/Reject button (so the same confirmations apply). They act only while focus is in the
 * page's content (the list or the details, or nowhere in particular), never while typing or in the
 * sidebar, and the viewer can switch them off.
 */
export function InboxKeys({
  ids,
  selected,
  base,
}: {
  ids: string[]
  selected?: string | undefined
  /** The inbox's address, with its filter (`?source=`); J and K add the `id`. */
  base: string
}) {
  const router = useRouter()
  const moved = useRef(false)
  /** The proposal the last J/K asked for; the selection catches up when the server answered. */
  const target = useRef<string | undefined>(undefined)
  const enabled = useShortcutsEnabled()

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return
      if (document.querySelector('dialog[open]')) return
      const el = e.target instanceof Element ? e.target : null
      const inScope = !el || el === document.body || el === document.documentElement || el.closest('#main')
      if (!inScope) return
      if (e.key === '?') {
        e.preventDefault()
        openShortcutSheet()
        return
      }
      // Enter does what the one primary button says (the recommendation), unless focus is on a
      // control of its own (a link, a button, a disclosure), where Enter keeps its usual meaning.
      if (e.key === 'Enter' && !e.repeat) {
        if (el?.closest('a, button, summary, [role="switch"], [contenteditable]')) return
        if (document.getElementById('decide-confirm') || document.querySelector('[data-deciding]')) return
        const primary = document.querySelector<HTMLButtonElement>('[data-recommended]')
        if (!primary || primary.offsetParent === null || primary.getAttribute('aria-busy') === 'true') return
        e.preventDefault()
        primary.click()
        return
      }
      const key = e.key.toLowerCase()
      if ((key === 'j' || key === 'k') && ids.length > 0) {
        // Move from where the viewer is: the focused row, else the last row asked for (keys pressed
        // faster than the server answers), else the selection.
        const focused = el?.closest<HTMLElement>('[data-proposal]')?.dataset.proposal
        const from = focused ?? target.current ?? selected
        const at = from ? ids.indexOf(from) : -1
        const next = at === -1 ? 0 : key === 'j' ? Math.min(at + 1, ids.length - 1) : Math.max(at - 1, 0)
        const id = ids[next]
        if (id === undefined || (id === from && at !== -1)) return
        e.preventDefault()
        moved.current = true
        target.current = id
        // The row shows where the cursor is right away; the details follow when they arrive.
        const row = document.querySelector<HTMLElement>(`[data-proposal="${CSS.escape(id)}"]`)
        if (row && row.offsetParent !== null) {
          row.focus({ preventScroll: true })
          row.scrollIntoView({ block: 'nearest' })
        }
        router.replace(withDecision(base, id), { scroll: false })
        return
      }
      const action = ACTIONS[key]
      if (!action || e.repeat) return
      // While a deletion asks for confirmation, A must not reach the destructive button.
      if (document.getElementById('decide-confirm')) return
      const button = document.getElementById(action) as HTMLButtonElement | null
      // Ignore waits under "More": X opens it and puts focus on Ignore with its consequence,
      // a second X (or Enter) ignores.
      if (key === 'x' && (!button || button.offsetParent === null)) {
        const more = document.getElementById('decide-more-toggle')
        if (!more || document.querySelector('[data-deciding]')) return
        e.preventDefault()
        if (more.getAttribute('aria-expanded') !== 'true') more.click()
        requestAnimationFrame(() => document.getElementById(action)?.focus())
        return
      }
      if (!button || button.disabled || button.offsetParent === null) return
      // A decision is running (its buttons stay focusable but answer no second press).
      if (button.getAttribute('aria-busy') === 'true' || document.querySelector('[data-deciding]')) return
      e.preventDefault()
      button.click()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [ids, selected, base, router, enabled])

  // A new selection starts at the top of its details; on phones the details are a page of their own.
  // After a keyboard move, focus follows the selection so the row is visible and announced; after a
  // decision or an undo, focus goes to the title of what is shown now.
  const previous = useRef(selected)
  useEffect(() => {
    if (previous.current === selected) return
    previous.current = selected
    // An answer for a row the viewer has already moved past: keep the cursor where it is.
    if (target.current && target.current !== selected) return
    target.current = undefined
    for (const aside of document.querySelectorAll('aside')) aside.scrollTop = 0
    const row = selected
      ? document.querySelector<HTMLElement>(`[data-proposal="${CSS.escape(selected)}"]`)
      : null
    if (!row || row.offsetParent === null) window.scrollTo({ top: 0 })
    if (Date.now() - focusTitleAt < 10_000) {
      focusTitleAt = 0
      moved.current = false
      focusInspectorTitle()
      return
    }
    if (!moved.current || !row) return
    moved.current = false
    if (row.offsetParent === null) {
      focusInspectorTitle()
      return
    }
    row.focus({ preventScroll: true })
    row.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return null
}
