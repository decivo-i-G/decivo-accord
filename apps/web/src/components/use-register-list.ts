'use client'

import { useRouter } from 'next/navigation'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { openShortcutSheet, useShortcutsEnabled } from './inbox-keys'

/**
 * Search text and one filter of a register list, mirrored into the URL (`?q=` and `?type=` or
 * `?status=`) without a navigation, so a reload or a shared link shows the same list.
 */
export function useUrlFilter(filterParam: string, initialQuery = '', initialFilter?: string) {
  const [query, setQuery] = useState(initialQuery)
  const [filter, setFilter] = useState<string | undefined>(initialFilter)

  useEffect(() => {
    const url = new URL(window.location.href)
    const q = query.trim()
    if (q) url.searchParams.set('q', q)
    else url.searchParams.delete('q')
    if (filter) url.searchParams.set(filterParam, filter)
    else url.searchParams.delete(filterParam)
    if (url.href !== window.location.href) window.history.replaceState(null, '', url)
  }, [query, filter, filterParam])

  return { query, setQuery, filter, setFilter }
}

const isTyping = (el: Element | null) =>
  Boolean(el?.closest('input, textarea, select, [contenteditable="true"]'))

/** Arrow keys move focus at once; the selection (a server round trip) follows when the keys rest. */
const ARROW_SETTLE_MS = 120

/** Visible row links of a list, in order (rows of folded groups are not rendered, so they are skipped). */
const rowLinks = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLAnchorElement>('[data-row-link]')].filter((l) => l.offsetParent !== null)

/**
 * Keyboard for a list of row links (`[data-row-link]`), like the inbox: ↑/↓ (while focus is in the
 * list) and J/K (anywhere in the page's content) move between rows and select them, C copies the
 * selected row's value (its `[data-copy]` button), Escape closes the inspector and "?" lists the keys.
 * Holding a key moves focus row by row and selects the row it stops on, replacing the URL instead of
 * stacking one history entry per row. The single-letter keys follow the viewer's shortcut switch.
 * `onMove` hears of every row the keys land on, before the server answers.
 */
export function useListKeys(
  list: RefObject<HTMLElement | null>,
  hasSelection: boolean,
  closeHref: string,
  onMove?: (link: HTMLAnchorElement) => void,
) {
  const router = useRouter()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const letters = useShortcutsEnabled()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      const active = document.activeElement
      if (isTyping(active) || document.querySelector('dialog[open]')) return
      const root = list.current
      if (!root) return
      const inMain = !active || active === document.body || Boolean(active.closest('#main'))
      if (e.key === 'Escape' && hasSelection) {
        router.push(closeHref, { scroll: false })
        return
      }
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (letters && inMain && key === '?') {
        e.preventDefault()
        openShortcutSheet()
        return
      }
      if (letters && inMain && key === 'c' && !e.repeat) {
        const copy = root
          .querySelector('[aria-current="true"]')
          ?.closest('tr, li')
          ?.querySelector<HTMLButtonElement>('[data-copy]')
        if (!copy) return
        e.preventDefault()
        copy.click()
        return
      }
      const arrow = key === 'ArrowDown' || key === 'ArrowUp'
      const letter = letters && inMain && (key === 'j' || key === 'k')
      if (!arrow && !letter) return
      if (arrow && (!active || !root.contains(active))) return
      const down = key === 'ArrowDown' || key === 'j'
      const links = rowLinks(root)
      // From the focused row, else the selected one; nothing yet starts at the first row.
      const from = root.contains(active) ? active?.closest('tr, li') : null
      const current = from ?? root.querySelector('[aria-current="true"]')?.closest('tr, li')
      const index = current ? links.findIndex((l) => current.contains(l)) : -1
      const next = index === -1 ? links[0] : links[index + (down ? 1 : -1)]
      if (!next) {
        // ↑ on the first row goes back to the search field above the list.
        const search = root
          .closest('[data-list-area]')
          ?.querySelector<HTMLInputElement>('input[type="search"]')
        if (arrow && !down && index === 0 && search) {
          e.preventDefault()
          search.focus()
        }
        return
      }
      e.preventDefault()
      next.focus({ preventScroll: true })
      next.closest('tr, li')?.scrollIntoView({ block: 'nearest' })
      onMove?.(next)
      clearTimeout(timer.current)
      const href = next.getAttribute('href')
      if (!href) return
      timer.current = setTimeout(() => router.replace(href, { scroll: false }), ARROW_SETTLE_MS)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      clearTimeout(timer.current)
    }
  }, [list, hasSelection, closeHref, router, letters, onMove])
}

/**
 * Keys in the search field of a list: ↓ moves into the results (first row, opened like ↑/↓ do in
 * the list), Enter opens the first result and keeps typing focus in the field.
 */
export function useSearchKeys(list: RefObject<HTMLElement | null>) {
  return useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.nativeEvent.isComposing) return
      if (e.key !== 'ArrowDown' && e.key !== 'Enter') return
      const first = list.current?.querySelector<HTMLAnchorElement>('[data-row-link]')
      if (!first) return
      e.preventDefault()
      if (e.key === 'ArrowDown') first.focus()
      first.click()
    },
    [list],
  )
}

/**
 * Keeps the selected row in view: a deep link (or a reload) centres its row once the layout has
 * settled, later selections (from the inspector's links, the keyboard) only scroll when the row is
 * out of view. Always an instant jump: a smooth scroll over thousands of pixels shows nothing but
 * blur, and reduced motion asks for none.
 */
export function useSelectedInView(
  list: RefObject<HTMLElement | null>,
  selected: string | undefined,
  /** Changes when a folded group opened to show the selection, so its row can come into view. */
  revealed = 0,
) {
  const first = useRef(true)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `revealed` re-runs it once the row exists
  useEffect(() => {
    if (!selected) return
    const frame = requestAnimationFrame(() => {
      const row = list.current?.querySelector('[aria-current="true"]')?.closest('tr, li')
      if (!row) return
      // Decided inside the frame, so a re-run of the effect (Strict Mode, a fast re-render) cannot
      // spend the first-load centring without scrolling.
      const block = first.current ? 'center' : 'nearest'
      first.current = false
      row.scrollIntoView({ block, behavior: 'instant' })
    })
    return () => cancelAnimationFrame(frame)
  }, [list, selected, revealed])
}
