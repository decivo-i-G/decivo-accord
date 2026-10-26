'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  createContext,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from 'react'
import { setLocale, setTheme } from '@/app/actions'
import { projectGlances } from '@/app/palette-actions'
import type { Glance } from '@/lib/glance'
import { type ProjectPage, projectHref } from '@/lib/routes'
import type { ThemeChoice } from '@/lib/theme'
import { IconButton } from './button'
import { Check, ChevronsUpDown, GitBranch, Menu, Monitor, Moon, Sun, X } from './icons'
import styles from './shell.module.css'
import { CountBadge } from './status-chip'

interface ProjectRef {
  slug: string
  name: string
  branch: string
}

/** Above this many projects the project list gets a filter field. */
const FILTER_FROM = 6

/** Long "owner/repo" names break after the slash, not inside a word. */
function ProjectName({ name }: { name: string }) {
  const at = name.indexOf('/')
  // On one line, owner muted and repository strong, cut with an ellipsis (the full name is the title).
  return (
    <span className={styles.projectName} title={name}>
      {at >= 0 && <span className={styles.projectOwner}>{name.slice(0, at + 1)}</span>}
      <span className={styles.projectRepo}>{at >= 0 ? name.slice(at + 1) : name}</span>
    </span>
  )
}

/**
 * Open/close behaviour shared by the sidebar popovers (project switcher, theme menu): Escape closes
 * and returns focus to the button, a click or focus outside closes.
 */
function usePopover(root: RefObject<HTMLElement | null>, button: RefObject<HTMLButtonElement | null>) {
  const [open, setOpen] = useState(false)
  const close = useCallback(
    (focusButton: boolean) => {
      setOpen(false)
      if (focusButton) button.current?.focus()
    },
    [button],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close(true)
      }
    }
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close(false)
    }
    const onFocus = (e: FocusEvent) => {
      if (!root.current?.contains(e.target as Node)) close(false)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('focusin', onFocus)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('focusin', onFocus)
    }
  }, [open, close, root])

  return { open, setOpen, close }
}

/**
 * All projects as links, the current one checked and each with its open decisions (nothing when
 * there are none), so you see which project needs you without opening it. The counts load when the
 * list is shown (`visible`), not on every page view. Used by the sidebar switcher and the phone drawer.
 */
export function ProjectList({
  projects,
  current,
  page,
  visible,
  onPick,
}: {
  projects: ProjectRef[]
  current?: string | undefined
  /** The page to keep when switching, so Register stays Register in the other project. */
  page?: ProjectPage | undefined
  visible: boolean
  onPick?: (() => void) | undefined
}) {
  const t = useTranslations('shell')
  const [query, setQuery] = useState('')
  const [glances, setGlances] = useState<Record<string, Glance>>({})
  const [, startTransition] = useTransition()

  useEffect(() => {
    if (!visible) return
    setQuery('')
    startTransition(async () => {
      const all = await projectGlances().catch(() => [] as Glance[])
      setGlances(Object.fromEntries(all.map((g) => [g.slug, g])))
    })
  }, [visible])

  const words = query.trim().toLowerCase()
  const shown = words ? projects.filter((p) => `${p.name} ${p.slug}`.toLowerCase().includes(words)) : projects

  return (
    <>
      {projects.length >= FILTER_FROM && (
        <label className={styles.popoverFilter}>
          <span className="visually-hidden">{t('filterProjects')}</span>
          <input
            type="search"
            value={query}
            placeholder={t('filterProjects')}
            onChange={(e) => setQuery(e.target.value)}
            className={styles.popoverInput}
          />
        </label>
      )}
      <ul className={styles.popoverList}>
        {shown.map((p) => {
          const glance = glances[p.slug]
          return (
            <li key={p.slug}>
              <Link
                href={projectHref(p.slug, page ?? 'overview')}
                className={styles.popoverItem}
                aria-current={p.slug === current ? 'true' : undefined}
                onClick={onPick}
              >
                <span className={styles.popoverName}>
                  <ProjectName name={p.name} />
                </span>
                {glance && glance.open > 0 && (
                  <CountBadge
                    count={glance.open}
                    label={t('needsYou', { count: glance.open })}
                    tone="brand"
                  />
                )}
                {p.slug === current && (
                  <>
                    <Check aria-hidden="true" className={styles.popoverCheck} />
                    <span className="visually-hidden">({t('current')})</span>
                  </>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
      {shown.length === 0 && (
        <p className={styles.popoverEmpty} role="status">
          {t('noProjectMatch', { query: query.trim() })}
        </p>
      )}
      <Link href="/" className={styles.popoverFooter} onClick={onPick}>
        {t('allProjects')}
      </Link>
    </>
  )
}

/**
 * Project switcher at the top of the sidebar, like Figma's file browser: the current project's name
 * with its branch under it, and on click the list of all projects. A disclosure (button + list of
 * links), not an ARIA menu, so links behave like links.
 */
export function ProjectSwitcher({
  projects,
  current,
  page,
}: {
  projects: ProjectRef[]
  current?: string | undefined
  page?: ProjectPage | undefined
}) {
  const t = useTranslations('shell')
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const { open, setOpen } = usePopover(root, button)
  const active = projects.find((p) => p.slug === current)

  return (
    <div className={styles.switcher} ref={root}>
      <button
        ref={button}
        type="button"
        className={styles.switcherButton}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.switcherText}>
          <span className="visually-hidden">{t('switchProject')}: </span>
          <span className={styles.switcherName}>
            {active ? <ProjectName name={active.name} /> : t('chooseProject')}
          </span>
          {active && (
            <span className={styles.switcherMeta}>
              <GitBranch aria-hidden="true" />
              {active.branch}
            </span>
          )}
        </span>
        <ChevronsUpDown aria-hidden="true" className={styles.switcherChevron} />
      </button>

      <div id={id} className={styles.popover} hidden={!open}>
        <p className={styles.popoverTitle}>{t('projects')}</p>
        <ProjectList
          projects={projects}
          current={current}
          page={page}
          visible={open}
          onPick={() => setOpen(false)}
        />
      </div>
    </div>
  )
}

const THEMES: { id: ThemeChoice; icon: ReactNode }[] = [
  { id: 'light', icon: <Sun aria-hidden="true" /> },
  { id: 'dark', icon: <Moon aria-hidden="true" /> },
  { id: 'system', icon: <Monitor aria-hidden="true" /> },
]

/** How long a touch has to rest on the theme button before the menu (with System) opens. */
const LONG_PRESS_MS = 500

/** Sets the scheme at once on the page; the form's server action stores it in the cookie. */
function applyTheme(next: ThemeChoice) {
  document.documentElement.dataset.theme = next
}

/**
 * The appearance switch, as design tools have it: one icon button, a moon in light mode ("switch to
 * dark") and a sun in dark mode ("switch to light"). It sits in the sidebar footer and, on phones, in
 * the top bar, so it is always one tap away. System is a rare wish, so it has no button of its own:
 * a long press or a right click opens a small menu that also offers it.
 *
 * Both buttons are rendered and CSS shows the one that fits `<html data-theme>` and, for System,
 * the OS scheme. So the icon is right on the first paint, the form works without JavaScript, and
 * with JavaScript the colours switch at once.
 */
export function ThemeSwitch({
  theme,
  place = 'footer',
}: {
  theme: ThemeChoice
  /** In the sidebar footer the tooltip and the menu open upwards, in the top bar downwards. */
  place?: 'footer' | 'topbar' | undefined
}) {
  const below = place === 'topbar'
  const t = useTranslations('shell')
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  /** Where focus returns when the menu closes: the button that opened it. */
  const opener = useRef<HTMLButtonElement | null>(null)
  const { open, setOpen, close } = usePopover(root, opener)
  const [chosen, setChosen] = useState<ThemeChoice>(theme)
  const timer = useRef<number | undefined>(undefined)
  const pressed = useRef(false)

  useEffect(() => setChosen(theme), [theme])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const apply = (next: ThemeChoice) => {
    setChosen(next)
    applyTheme(next)
  }

  const openMenu = (from: HTMLButtonElement) => {
    opener.current = from
    setOpen(true)
  }

  /** The toggle that is now visible, so keyboard focus is not lost when its twin hides. */
  const focusToggle = () => {
    const buttons = root.current?.querySelectorAll<HTMLButtonElement>('button[data-toggle]') ?? []
    for (const b of buttons) if (b.offsetParent !== null) b.focus()
  }

  const toggle = (next: 'light' | 'dark') => ({
    onClick: (e: ReactMouseEvent<HTMLButtonElement>) => {
      if (pressed.current) {
        // The long press opened the menu; the touch that ends it is not a click on the switch.
        e.preventDefault()
        pressed.current = false
        return
      }
      const hadFocus = document.activeElement === e.currentTarget
      apply(next)
      if (hadFocus) focusToggle()
    },
    onContextMenu: (e: ReactMouseEvent<HTMLButtonElement>) => {
      e.preventDefault()
      openMenu(e.currentTarget)
    },
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.pointerType === 'mouse') return
      pressed.current = false
      const from = e.currentTarget
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        pressed.current = true
        openMenu(from)
      }, LONG_PRESS_MS)
    },
    onPointerUp: () => window.clearTimeout(timer.current),
    onPointerLeave: () => window.clearTimeout(timer.current),
    onPointerCancel: () => window.clearTimeout(timer.current),
  })

  return (
    <div
      className={`${styles.theme} ${below ? styles.themeTop : ''}`}
      ref={root}
      data-menu-open={open || undefined}
    >
      <form action={setTheme} className={styles.themeForm}>
        <IconButton
          type="submit"
          name="theme"
          value="dark"
          data-toggle="dark"
          className={`${styles.themeToggle} ${styles.whenLight}`}
          label={t('themeToDark')}
          icon={<Moon aria-hidden="true" />}
          tooltip="end"
          tooltipAbove={!below}
          {...toggle('dark')}
        />
        <IconButton
          type="submit"
          name="theme"
          value="light"
          data-toggle="light"
          className={`${styles.themeToggle} ${styles.whenDark}`}
          label={t('themeToLight')}
          icon={<Sun aria-hidden="true" />}
          tooltip="end"
          tooltipAbove={!below}
          {...toggle('light')}
        />
      </form>
      <div id={id} className={`${styles.popover} ${styles.themeMenu}`} hidden={!open}>
        <form action={setTheme}>
          <fieldset className={styles.fieldset}>
            <legend className={styles.popoverTitle}>{t('theme')}</legend>
            {THEMES.map(({ id: value, icon }) => (
              <button
                key={value}
                type="submit"
                name="theme"
                value={value}
                aria-pressed={value === chosen}
                className={styles.popoverItem}
                onClick={() => {
                  apply(value)
                  close(true)
                }}
              >
                {icon}
                <span className={styles.popoverName}>{t(`themeName.${value}`)}</span>
                {value === chosen && <Check aria-hidden="true" className={styles.popoverCheck} />}
              </button>
            ))}
          </fieldset>
        </form>
      </div>
    </div>
  )
}

/**
 * The interface language as a compact DE/EN switch. A plain form with a server action, so it works
 * without JavaScript; the pressed language is bold and filled.
 */
export function LanguageSwitch({ locale }: { locale: string }) {
  const t = useTranslations()
  return (
    <form action={setLocale} className={styles.language}>
      <fieldset className={styles.fieldset}>
        <legend className="visually-hidden">{t('nav.language')}</legend>
        <div className={styles.segmented}>
          {(['de', 'en'] as const).map((l) => (
            <button
              key={l}
              type="submit"
              name="locale"
              value={l}
              aria-pressed={l === locale}
              lang={l}
              className={styles.segment}
            >
              <span aria-hidden="true">{l.toUpperCase()}</span>
              <span className="visually-hidden">{t(`shell.languageName.${l}`)}</span>
            </button>
          ))}
        </div>
      </fieldset>
    </form>
  )
}

/** The sidebar footer (and the foot of the phone drawer): language and appearance, both one tap away. */
export function SidebarFooter({ locale, theme }: { locale: string; theme: ThemeChoice }) {
  return (
    <div className={styles.footer}>
      <LanguageSwitch locale={locale} />
      <ThemeSwitch theme={theme} />
    </div>
  )
}

/** Whether the phone drawer is open (its project list loads the counts only then) and how to close it. */
const Drawer = createContext<{ open: boolean; close: () => void }>({ open: false, close: () => {} })

/** The project list inside the phone drawer; it loads the open decisions when the drawer opens. */
export function DrawerProjects(props: {
  projects: ProjectRef[]
  current?: string | undefined
  page?: ProjectPage | undefined
}) {
  const { open, close } = useContext(Drawer)
  return <ProjectList {...props} visible={open} onPick={close} />
}

/**
 * "boundlessfi/boundless" for the phone's top bar: when it does not fit, the owner is cut
 * ("bound…/boundless"), never the repository, which is the part that tells projects apart.
 */
function MenuName({ name }: { name: string }) {
  const at = name.lastIndexOf('/')
  if (at < 0) return <span className={styles.menuRepo}>{name}</span>
  return (
    <>
      <span className={styles.menuOwner}>{name.slice(0, at)}</span>
      <span className={styles.menuRepo}>{name.slice(at)}</span>
    </>
  )
}

/**
 * On phones the top bar starts with the menu button: the menu icon and the project's name. It opens
 * the drawer, a native modal `<dialog>` (focus stays inside, Escape closes, the page behind is inert)
 * with what the tab bar does not hold: all projects, the project's connections, language and
 * appearance, laid out like the desktop sidebar. On the project list it is the icon alone. On the
 * connections (`current`), which live in this drawer, the button is tinted like the desktop gear.
 * The drawer closes on navigation, and focus returns to the button.
 */
export function MobileMenu({
  project,
  current = false,
  children,
}: {
  project?: string | undefined
  current?: boolean | undefined
  children: ReactNode
}) {
  const t = useTranslations('shell')
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const close = useCallback(() => dialog.current?.close(), [])

  useEffect(() => {
    if (pathname) dialog.current?.close()
  }, [pathname])

  return (
    <>
      <button
        type="button"
        className={`${styles.menuButton} ${project ? '' : styles.menuButtonIcon}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-current={current || undefined}
        onClick={() => {
          dialog.current?.showModal()
          setOpen(true)
        }}
      >
        <Menu aria-hidden="true" className={styles.menuIcon} />
        {project ? (
          <span className={styles.menuName}>
            <span className="visually-hidden">{t('menu')}: </span>
            <MenuName name={project} />
          </span>
        ) : (
          <span className="visually-hidden">{t('menu')}</span>
        )}
      </button>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click only; Escape closes the dialog natively */}
      <dialog
        ref={dialog}
        className={styles.drawer}
        aria-labelledby={title}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          // A click on the backdrop lands on the dialog itself, not on its content.
          if (e.target === dialog.current) dialog.current.close()
        }}
      >
        <div className={styles.drawerBody}>
          <div className={styles.drawerHead}>
            <h2 id={title} className={styles.drawerTitle}>
              {t('projects')}
            </h2>
            <IconButton
              label={t('closeMenu')}
              icon={<X aria-hidden="true" />}
              tooltip="end"
              onClick={close}
            />
          </div>
          <Drawer.Provider value={{ open, close }}>{children}</Drawer.Provider>
        </div>
      </dialog>
    </>
  )
}

/**
 * Escape hides the icon buttons' tooltips (WCAG 1.4.13: content on hover or focus can be dismissed
 * without moving). They stay hidden until focus moves or the pointer goes to another element.
 */
export function TooltipDismiss() {
  useEffect(() => {
    const root = document.documentElement
    let under: Element | null = null
    const clear = () => {
      under = null
      delete root.dataset.tipsOff
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      under = [...document.querySelectorAll(':hover')].pop()?.closest('a, button') ?? null
      root.dataset.tipsOff = ''
    }
    const onPointer = (e: PointerEvent) => {
      if (root.dataset.tipsOff === undefined) return
      if (under && e.target instanceof Node && under.contains(e.target)) return
      clear()
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('focusin', clear)
    document.addEventListener('pointerover', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('focusin', clear)
      document.removeEventListener('pointerover', onPointer)
    }
  }, [])
  return null
}
