'use client'

import { useTranslations } from 'next-intl'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from './icons'
import styles from './toast.module.css'

export type ToastTone = 'success' | 'info' | 'warning' | 'danger'

export interface ToastInput {
  message: string
  tone?: ToastTone | undefined
  /** One optional follow-up, e.g. "Undo" or "Open pull request". */
  action?: { label: string; onClick: () => void } | undefined
  /** Milliseconds until it disappears; paused while hovered or focused. Default 6000. */
  duration?: number | undefined
}

interface ToastItem extends ToastInput {
  id: number
}

const ToastContext = createContext<{ show: (toast: ToastInput) => void } | null>(null)

/** One polite live region for short confirmations without a toast ("kopiert"), shared by every copy button. */
const AnnounceContext = createContext<((message: string) => void) | null>(null)

const ICON: Record<ToastTone, ReactNode> = {
  success: <CircleCheck aria-hidden="true" />,
  info: <Info aria-hidden="true" />,
  warning: <TriangleAlert aria-hidden="true" />,
  danger: <CircleAlert aria-hidden="true" />,
}

/**
 * Confirmations at the bottom left of the canvas (under the top bar on narrow screens), never over the
 * decision buttons; announced politely to screen readers. One at a time: a new confirmation replaces
 * the last one, so quick decisions in a row never stack over the list (each decided row keeps its
 * own Undo).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const next = useRef(1)
  const show = useCallback((toast: ToastInput) => {
    const id = next.current++
    setItems([{ ...toast, id }])
  }, [])
  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), [])
  const value = useMemo(() => ({ show }), [show])
  // A new key per message replaces the text node, so the same sentence twice is announced twice.
  const [said, setSaid] = useState({ id: 0, text: '' })
  const announce = useCallback((text: string) => setSaid((s) => ({ id: s.id + 1, text })), [])
  return (
    <ToastContext.Provider value={value}>
      <AnnounceContext.Provider value={announce}>
        {children}
        <ToastRegion items={items} dismiss={dismiss} />
        <span className="visually-hidden" role="status">
          <span key={said.id}>{said.text}</span>
        </span>
      </AnnounceContext.Provider>
    </ToastContext.Provider>
  )
}

function ToastRegion({ items, dismiss }: { items: ToastItem[]; dismiss: (id: number) => void }) {
  const t = useTranslations('ui')
  return (
    <section aria-label={t('notifications')}>
      <ol className={styles.region} aria-live="polite" aria-relevant="additions">
        {items.map((item) => (
          <ToastView key={item.id} item={item} dismiss={dismiss} closeLabel={t('dismiss')} />
        ))}
      </ol>
    </section>
  )
}

function ToastView({
  item,
  dismiss,
  closeLabel,
}: {
  item: ToastItem
  dismiss: (id: number) => void
  closeLabel: string
}) {
  const [paused, setPaused] = useState(false)
  const tone = item.tone ?? 'success'
  useEffect(() => {
    if (paused) return
    const timer = setTimeout(() => dismiss(item.id), item.duration ?? 6000)
    return () => clearTimeout(timer)
  }, [paused, item.id, item.duration, dismiss])
  return (
    <li
      className={`${styles.toast} ${styles[tone]}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className={styles.icon}>{ICON[tone]}</span>
      <span className={styles.message}>{item.message}</span>
      {item.action && (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            item.action?.onClick()
            dismiss(item.id)
          }}
        >
          {item.action.label}
        </button>
      )}
      <button type="button" className={styles.close} aria-label={closeLabel} onClick={() => dismiss(item.id)}>
        <X aria-hidden="true" />
      </button>
    </li>
  )
}

/** Say a short confirmation in the shared live region; undefined outside a <ToastProvider>. */
export function useAnnounce() {
  return useContext(AnnounceContext) ?? undefined
}

/** Show a confirmation from a client component. */
export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast needs a <ToastProvider> (see app/layout.tsx)')
  return context
}

/**
 * Show a confirmation once when a server-rendered page asks for it, e.g. after a server action
 * redirected with `?done=adopted`. `id` makes sure it shows only once per result.
 */
export function FlashToast({ id, message, tone }: { id: string; message: string; tone?: ToastTone }) {
  const { show } = useToast()
  const shown = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (shown.current === id) return
    shown.current = id
    show({ message, tone })
  }, [id, message, tone, show])
  return null
}
