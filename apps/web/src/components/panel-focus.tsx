'use client'

import { useEffect, useRef } from 'react'

/** A selector that finds the same list row again after the server re-rendered the list. */
function selectorOf(el: Element | null): string | undefined {
  const row = el?.closest<HTMLElement>('[data-proposal], [data-row-id], a[href]')
  if (!row) return undefined
  if (row.dataset.proposal) return `[data-proposal="${CSS.escape(row.dataset.proposal)}"]`
  if (row.dataset.rowId) return `[data-row-id="${CSS.escape(row.dataset.rowId)}"]`
  const href = row.getAttribute('href')
  return href ? `a[href="${CSS.escape(href)}"]` : undefined
}

const visible = (el: Element | null): el is HTMLElement =>
  el instanceof HTMLElement && el.isConnected && el.offsetParent !== null

/**
 * On narrow screens the inspector replaces the list as a page of its own. When it opens (a row was
 * tapped) the focused row disappears, so focus moves to the inspector's title instead of falling to
 * <body> (WCAG 2.4.3). Back on the list ("Back to …"), focus returns to the row that was opened. The
 * first render after a page load (a deep link) keeps the browser's own focus. The last state lives
 * outside the component: an inspector may remount for each selection.
 *
 * It also keeps a disclosure that opens inside the scrolling inspector in view: its content would
 * otherwise start under the sticky footer, and the click would seem to do nothing.
 */
let last: string | undefined
/** The row the inspector was opened from on a narrow screen. */
let opener: string | undefined
export function FocusOnOpen({ title }: { title: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const layout = ref.current?.closest('[data-open]')
    if (!layout) return
    const open = layout.getAttribute('data-open') === 'true'
    const key = `${open}|${title}`
    const first = last === undefined
    if (last === key) return
    const wasOpen = last?.startsWith('true|') ?? false
    last = key
    if (first) return
    const main = layout.querySelector('[data-panel-main]')
    if (!main) return
    const active = document.activeElement as HTMLElement | null
    const lost = !visible(active) || active === document.body
    if (!open) {
      // Back from the inspector page: the list shows again; focus the row it was opened from.
      if (!wasOpen || !lost || getComputedStyle(main).display === 'none') return
      const row = opener ? document.querySelector(opener) : null
      opener = undefined
      if (visible(row)) row.focus({ preventScroll: false })
      else document.getElementById('main')?.focus()
      return
    }
    if (getComputedStyle(main).display !== 'none') return
    if (!lost) return
    opener = selectorOf(active) ?? opener
    document.getElementById('inspector-title')?.focus()
  })

  useEffect(() => {
    const aside = ref.current?.closest('aside')
    if (!aside) return
    const onToggle = (e: Event) => {
      const details = e.target
      if (!(details instanceof HTMLDetailsElement) || !details.open) return
      requestAnimationFrame(() => {
        const content = details.querySelector(':scope > :not(summary)')
        const summary = details.querySelector(':scope > summary')
        const scroller = details.closest('aside') ?? document.scrollingElement
        if (!content || !scroller) return
        const room =
          (scroller === document.scrollingElement ? window.innerHeight : scroller.clientHeight) * 0.6
        // Short content comes fully into view; long content starts at its summary.
        if (content.getBoundingClientRect().height < room) content.scrollIntoView({ block: 'nearest' })
        else summary?.scrollIntoView({ block: 'start' })
      })
    }
    aside.addEventListener('toggle', onToggle, true)
    return () => aside.removeEventListener('toggle', onToggle, true)
  }, [])
  return <span ref={ref} hidden />
}
