'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import { elsewhereItems, paletteItems } from '@/app/palette-actions'
import { type PaletteGroup, type PaletteItem, searchPalette } from '@/lib/palette'
import { LoadingDots } from './brand-dots'
import styles from './command-palette.module.css'
import {
  ArrowRight,
  BookOpen,
  Component,
  CornerDownLeft,
  FolderGit2,
  Inbox,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  Scale,
  Search,
  Settings,
  X,
} from './icons'
import { Kbd } from './kbd'
import { Swatch } from './swatch'

const PAGE_ICON: Record<string, ReactNode> = {
  overview: <LayoutDashboard aria-hidden="true" />,
  decisions: <Inbox aria-hidden="true" />,
  register: <BookOpen aria-hidden="true" />,
  components: <Component aria-hidden="true" />,
  rules: <Scale aria-hidden="true" />,
  connections: <Settings aria-hidden="true" />,
  home: <LayoutGrid aria-hidden="true" />,
}

const GROUP_ICON: Record<PaletteGroup, ReactNode> = {
  pages: <LayoutGrid aria-hidden="true" />,
  proposals: <Inbox aria-hidden="true" />,
  tokens: <Layers aria-hidden="true" />,
  components: <Component aria-hidden="true" />,
  decisions: <Scale aria-hidden="true" />,
  elsewhere: <Layers aria-hidden="true" />,
  projects: <FolderGit2 aria-hidden="true" />,
}

/** Icon of a hit in another project: by the kind it has there (token, component, rule). */
const KIND_ICON: Record<string, ReactNode> = {
  token: GROUP_ICON.tokens,
  component: GROUP_ICON.components,
  decision: GROUP_ICON.decisions,
}

function iconOf(item: PaletteItem): ReactNode {
  if (item.swatch) return <Swatch color={item.swatch} size="sm" />
  if (item.group === 'pages') return PAGE_ICON[item.key.replace('page:', '')] ?? GROUP_ICON.pages
  if (item.group === 'elsewhere') return KIND_ICON[item.key.split(':')[2] ?? ''] ?? GROUP_ICON.elsewhere
  return GROUP_ICON[item.group]
}

/** ⌘ on Apple keyboards, Ctrl elsewhere; decided after mount so server and client markup agree. */
function useModKey() {
  const [mac, setMac] = useState(false)
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent))
  }, [])
  return mac ? '⌘' : 'Ctrl'
}

/**
 * Command palette like Linear's, Raycast's or Figma's quick actions: ⌘K / Ctrl+K from anywhere,
 * or the search button in the top bar. A native modal `<dialog>` (focus stays inside, Escape closes,
 * focus returns to where it was), a combobox input and a listbox of links grouped by kind.
 * Pages and projects are there at once; the project's proposals, tokens, components and decisions
 * load when the palette first opens.
 */
export function CommandPalette({
  project,
  pages,
  projects,
}: {
  project?: string | undefined
  pages: PaletteItem[]
  projects: PaletteItem[]
}) {
  const t = useTranslations('palette')
  const ts = useTranslations('shell')
  const router = useRouter()
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const mod = useModKey()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [data, setData] = useState<{ project: string | undefined; items: PaletteItem[] } | undefined>()
  const [failed, setFailed] = useState(false)
  const [loading, startLoading] = useTransition()

  // This project's content, and the other projects' tokens, components and rules for when it has none.
  const load = useCallback(() => {
    startLoading(async () => {
      try {
        const [own, elsewhere] = await Promise.all([
          project ? paletteItems(project) : Promise.resolve([]),
          elsewhereItems(project),
        ])
        setData({ project, items: [...own, ...elsewhere] })
        setFailed(false)
      } catch {
        setFailed(true)
      }
    })
  }, [project])

  const show = useCallback(() => {
    const d = dialog.current
    if (!d || d.open) return
    setQuery('')
    setActive(0)
    d.showModal()
    input.current?.focus()
    load()
  }, [load])

  const hide = useCallback(() => dialog.current?.close(), [])

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (dialog.current?.open) hide()
        else show()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [show, hide])

  const items = useMemo(
    () => [...pages, ...(data && data.project === project ? data.items : []), ...projects],
    [pages, projects, data, project],
  )
  const sections = useMemo(() => searchPalette(items, query), [items, query])
  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections])
  const current = flat[Math.min(active, flat.length - 1)]
  const optionId = (item: PaletteItem) => `${id}-${item.key.replace(/[^a-zA-Z0-9_-]/g, '_')}`

  useEffect(() => {
    if (!current) return
    document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' })
  })

  const go = (item: PaletteItem) => {
    hide()
    router.push(item.href)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (flat.length === 0) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (Math.min(i, flat.length - 1) + step + flat.length) % flat.length)
    } else if (e.key === 'Home' && e.ctrlKey) {
      setActive(0)
    } else if (e.key === 'End' && e.ctrlKey) {
      setActive(flat.length - 1)
    } else if (e.key === 'Enter' && current && !e.nativeEvent.isComposing) {
      e.preventDefault()
      go(current)
    }
  }

  const status =
    query.trim() && loading && !data ? t('loading') : query.trim() ? t('results', { count: flat.length }) : ''

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
        onClick={show}
      >
        <Search aria-hidden="true" />
        <span className={styles.triggerLabel}>{ts('search')}</span>
        <span className={styles.triggerKeys} aria-hidden="true">
          <Kbd>{mod}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click only; Escape closes the dialog natively */}
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-label={t('title')}
        onClick={(e) => {
          if (e.target === dialog.current) hide()
        }}
      >
        <div className={styles.box}>
          <div className={styles.head}>
            <Search aria-hidden="true" className={styles.headIcon} />
            <label htmlFor={`${id}-input`} className="visually-hidden">
              {t('label')}
            </label>
            <input
              ref={input}
              id={`${id}-input`}
              className={styles.input}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={`${id}-list`}
              aria-autocomplete="list"
              aria-activedescendant={current ? optionId(current) : undefined}
              autoComplete="off"
              spellCheck={false}
              placeholder={t('placeholder')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              onKeyDown={onKeyDown}
            />
            <button type="button" className={styles.close} aria-label={t('close')} onClick={hide}>
              <X aria-hidden="true" />
            </button>
          </div>

          <div id={`${id}-list`} role="listbox" aria-label={t('title')} className={styles.list}>
            {sections.map((section) => (
              // biome-ignore lint/a11y/useSemanticElements: a group inside a listbox (ARIA combobox pattern), not a form fieldset
              <div key={section.group} role="group" aria-labelledby={`${id}-${section.group}`}>
                <div id={`${id}-${section.group}`} className={styles.groupLabel}>
                  {section.group === 'elsewhere' && !project
                    ? t('group.inProjects')
                    : t(`group.${section.group}`)}
                </div>
                {section.items.map((item) => {
                  const selected = item === current
                  return (
                    <Link
                      key={item.key}
                      id={optionId(item)}
                      href={item.href}
                      role="option"
                      aria-selected={selected}
                      tabIndex={-1}
                      className={styles.option}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey) return
                        hide()
                      }}
                      onMouseMove={() => {
                        const at = flat.indexOf(item)
                        if (at !== active) setActive(at)
                      }}
                    >
                      <span className={styles.optionIcon}>{iconOf(item)}</span>
                      <span className={styles.optionText}>
                        <span className={`${styles.optionLabel} ${item.mono ? styles.mono : ''}`}>
                          {item.label}
                        </span>
                        {(item.alias || item.detail) && (
                          <span className={styles.optionDetail}>
                            {item.alias && (
                              <>
                                <ArrowRight aria-hidden="true" className={styles.aliasArrow} />
                                <span className="visually-hidden">{t('aliasOf')} </span>
                                <span className={styles.alias}>{item.alias}</span>
                                {item.detail && ' · '}
                              </>
                            )}
                            {item.detail}
                          </span>
                        )}
                      </span>
                      {item.badge && <span className={styles.badge}>{item.badge}</span>}
                      <CornerDownLeft aria-hidden="true" className={styles.enter} />
                    </Link>
                  )
                })}
              </div>
            ))}
          </div>

          {query.trim() && flat.length === 0 && !loading && (
            <p className={styles.empty}>{t('empty', { query: query.trim() })}</p>
          )}
          {failed && <p className={styles.empty}>{t('error')}</p>}

          <div className={styles.foot}>
            <span className={styles.hints} aria-hidden="true">
              <span className={styles.hint}>
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                {t('hint.move')}
              </span>
              <span className={styles.hint}>
                <Kbd>↵</Kbd>
                {t('hint.open')}
              </span>
              <span className={styles.hint}>
                <Kbd>Esc</Kbd>
                {t('hint.close')}
              </span>
            </span>
            <span className={styles.count} role="status">
              {query.trim() && loading && !data && <LoadingDots />}
              {status}
            </span>
          </div>
        </div>
      </dialog>
    </>
  )
}
