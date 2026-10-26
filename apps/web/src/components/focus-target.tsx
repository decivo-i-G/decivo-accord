'use client'

import { useEffect } from 'react'

/**
 * After a jump to `#figma` (the overview's surface line), the row moves to the top, gets the selected
 * tint and focus moves to its heading, so keyboard and screen-reader users land where the eye does.
 * The tint is set as `data-target`: CSS `:target` does not follow a client-side navigation, which only
 * pushes the hash. Only ids inside `scope` count; any other hash keeps the browser's own focus.
 */
export function FocusTarget({ scope }: { scope: string }) {
  useEffect(() => {
    const mark = () => {
      const id = decodeURIComponent(window.location.hash.slice(1))
      const list = document.getElementById(scope)
      for (const el of list?.querySelectorAll('[data-target]') ?? []) el.removeAttribute('data-target')
      if (!id) return
      const target = document.getElementById(id)
      if (!target || !list?.contains(target)) return
      target.setAttribute('data-target', '')
      // An instant jump: the one authored motion of the app is elsewhere, and reduced motion is kept.
      target.scrollIntoView({ block: 'start' })
      const heading = target.querySelector<HTMLElement>('h2')
      if (!heading) return
      heading.tabIndex = -1
      heading.focus({ preventScroll: true })
    }
    mark()
    window.addEventListener('hashchange', mark)
    return () => window.removeEventListener('hashchange', mark)
  }, [scope])
  return null
}
