import { cookies } from 'next/headers'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { type Glance, glanceOf } from '@/lib/glance'
import type { PaletteItem } from '@/lib/palette'
import { listProjects, type Project } from '@/lib/projects'
import { registerHref } from '@/lib/register-href'
import { type ProjectPage, projectHref, SECTIONS, type Section } from '@/lib/routes'
import { THEME_COOKIE, themeFrom } from '@/lib/theme'
import { BrandDots } from './brand-dots'
import { Breadcrumbs, type Crumb } from './breadcrumbs'
import { IconLink } from './button'
import { CommandPalette } from './command-palette'
import { BookOpen, Inbox, LayoutDashboard, Settings } from './icons'
import styles from './shell.module.css'
import {
  DrawerProjects,
  MobileMenu,
  ProjectSwitcher,
  SidebarFooter,
  ThemeSwitch,
  TooltipDismiss,
} from './shell-client'

const ICONS: Record<Section, ReactNode> = {
  overview: <LayoutDashboard aria-hidden="true" />,
  decisions: <Inbox aria-hidden="true" />,
  register: <BookOpen aria-hidden="true" />,
}

type T = Awaited<ReturnType<typeof getTranslations>>

/**
 * The one number in the navigation: the open decisions next to "Entscheidungen" (it reaches 0 at
 * inbox zero and then disappears). Nothing else gets a number here, so a number always means "to do".
 * The visible number is hidden from screen readers; one sentence after the name says the same
 * ("Entscheidungen, 5 Entscheidungen offen").
 */
function OpenCount({
  section,
  glance,
  t,
  place,
}: {
  section: Section
  glance: Glance | undefined
  t: T
  place: 'sidebar' | 'tabbar'
}) {
  if (!glance || section !== 'decisions' || glance.open === 0) return null
  return (
    <>
      <span
        className={`${styles.count} ${place === 'tabbar' ? styles.tabCount : ''}`}
        data-tone="brand"
        aria-hidden="true"
      >
        {glance.open}
      </span>
      <span className="visually-hidden">, {t('shell.needsYou', { count: glance.open })}</span>
    </>
  )
}

/**
 * App frame like a design tool: sidebar with project switcher and sections on the left, a slim top
 * bar with breadcrumbs and search (⌘K), the canvas in the middle. On phones the sections move to a
 * bottom tab bar, and the top bar holds the menu button with the project's name, the sun/moon switch
 * and search. The menu opens a drawer with what the tab bar does not hold (all projects, the
 * connections, language and appearance), laid out like the sidebar. The tab bar marks a section only
 * on its own pages: the connections are no section, so there the menu button is tinted instead.
 */
export async function Shell({
  project,
  active,
  item,
  actions,
  flush = false,
  children,
}: {
  project?: Pick<Project, 'slug' | 'name' | 'branch'> | undefined
  /** The current page: one of the three sections, or the project settings (Verbindungen). */
  active?: ProjectPage | undefined
  /** Third breadcrumb level, e.g. the selected proposal; `code` sets it in mono (a token path). */
  item?: string | { label: string; code?: boolean | undefined } | undefined
  /** Page actions in the top bar (right). */
  actions?: ReactNode
  /** Without padding and width limit; for layouts with a docked inspector (`PanelLayout`). */
  flush?: boolean | undefined
  children: ReactNode
}) {
  const t = await getTranslations()
  const locale = await getLocale()
  const theme = themeFrom((await cookies()).get(THEME_COOKIE)?.value)
  const projects = listProjects().map((p) => ({ slug: p.slug, name: p.name, branch: p.branch }))
  const glance = project ? await glanceOf(project.slug).catch(() => undefined) : undefined
  // On the project list the sidebar lists the projects, like the switcher would, with their open decisions.
  const glances = project
    ? []
    : await Promise.all(projects.map((p) => glanceOf(p.slug).catch(() => ({ slug: p.slug, open: 0 }))))
  const third = typeof item === 'string' ? { label: item } : item

  // The project crumb leads to the project start, the overview; on the overview itself it is plain text.
  const crumbs: Crumb[] = project
    ? [
        {
          label: project.name,
          project: true,
          href: active === 'overview' && !item ? undefined : projectHref(project.slug),
        },
        // Connections is the project settings (the gear, "Projekteinstellungen: Verbindungen"): the path
        // names it like the drawer does, with no crumb for a settings page that does not exist on its own.
        ...(active
          ? [{ label: t(`nav.${active}`), href: item ? projectHref(project.slug, active) : undefined }]
          : []),
        ...(third ? [third] : []),
      ]
    : // Outside a project (the project list) the H1 names the page; a one-word path would only repeat it.
      []

  // The palette's fixed part: this project's pages and all projects. Its data loads on open.
  const pages: PaletteItem[] = [
    ...(project
      ? [
          ...([...SECTIONS, 'connections'] as const).map((page) => ({
            group: 'pages' as const,
            key: `page:${page}`,
            label: t(`nav.${page}`),
            detail: page === 'connections' ? `${t('nav.settings')} · ${project.name}` : project.name,
            href: projectHref(project.slug, page),
          })),
          ...(['components', 'rules'] as const).map((tab) => ({
            group: 'pages' as const,
            key: `page:${tab}`,
            label: t(`register.tabs.${tab}`),
            detail: `${t('nav.register')} · ${project.name}`,
            href: registerHref(projectHref(project.slug, 'register'), { tab }),
          })),
        ]
      : []),
    { group: 'pages', key: 'page:home', label: t('palette.allProjects'), href: '/' },
  ]
  const paletteProjects: PaletteItem[] = projects.map((p) => ({
    group: 'projects',
    key: `project:${p.slug}`,
    label: p.name,
    detail: p.branch,
    href: projectHref(p.slug, active ?? 'overview'),
    keywords: p.slug,
  }))

  const sidebar = (
    <>
      <Link href="/" className={styles.brand} aria-label={t('shell.home')}>
        <BrandDots size="md" />
        <span className={styles.brandText}>
          <span className={styles.brandWord}>{t('app.brand')}</span>
          <span className={styles.product}>{t('app.product')}</span>
        </span>
      </Link>

      {/* On the project list there is no project to switch: the sidebar lists them all instead. */}
      {!project && projects.length > 0 && (
        <nav aria-labelledby="sidebar-projects" className={styles.sideNav}>
          <p id="sidebar-projects" className={styles.navTitle}>
            {t('shell.projects')}
          </p>
          <ul className={styles.links}>
            {projects.map((p, i) => {
              const open = glances[i]?.open ?? 0
              return (
                <li key={p.slug}>
                  <Link href={projectHref(p.slug)} className={styles.link}>
                    <span className={styles.linkLabel}>{p.name}</span>
                    {open > 0 && (
                      <>
                        <span className={styles.count} data-tone="brand" aria-hidden="true">
                          {open}
                        </span>
                        <span className="visually-hidden">, {t('shell.needsYou', { count: open })}</span>
                      </>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      )}

      {project && (
        <div className={styles.switcherRow}>
          <ProjectSwitcher projects={projects} current={project.slug} page={active} />
          <IconLink
            href={projectHref(project.slug, 'connections')}
            label={t('shell.settings')}
            icon={<Settings aria-hidden="true" />}
            tooltip="end"
            className={styles.settings}
            aria-current={active === 'connections' ? 'page' : undefined}
          />
        </div>
      )}

      {project && (
        <nav aria-label={t('nav.label')} className={styles.sideNav}>
          <ul className={styles.links}>
            {SECTIONS.map((section) => (
              <li key={section}>
                <Link
                  href={projectHref(project.slug, section)}
                  className={styles.link}
                  aria-current={section === active ? 'page' : undefined}
                >
                  {ICONS[section]}
                  <span className={styles.linkLabel}>{t(`nav.${section}`)}</span>
                  <OpenCount section={section} glance={glance} t={t} place="sidebar" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <SidebarFooter locale={locale} theme={theme} />
    </>
  )

  return (
    <div className={styles.shell}>
      <TooltipDismiss />
      <aside className={styles.sidebar} aria-label={t('shell.sidebar')}>
        {sidebar}
      </aside>

      <div className={styles.frame}>
        <header className={styles.topbar}>
          <MobileMenu project={project?.name} current={active === 'connections'}>
            <DrawerProjects projects={projects} current={project?.slug} page={active} />
            {project && (
              <Link
                href={projectHref(project.slug, 'connections')}
                className={styles.drawerLink}
                aria-current={active === 'connections' ? 'page' : undefined}
              >
                <Settings aria-hidden="true" />
                {t('nav.connections')}
              </Link>
            )}
            <SidebarFooter locale={locale} theme={theme} />
          </MobileMenu>
          {/* On phones the H1 names the page right below, so the path shows only below a section (an item). */}
          {crumbs.length > 0 ? (
            <Breadcrumbs label={t('shell.breadcrumbs')} items={crumbs} phone={Boolean(third)} />
          ) : (
            <span className={styles.topSpacer} />
          )}
          {actions && <div className={styles.topActions}>{actions}</div>}
          <div className={styles.topTheme}>
            <ThemeSwitch theme={theme} place="topbar" />
          </div>
          <CommandPalette project={project?.slug} pages={pages} projects={paletteProjects} />
        </header>

        <main id="main" tabIndex={-1} className={flush ? styles.mainFlush : styles.main}>
          {flush ? children : <div className={styles.content}>{children}</div>}
        </main>
      </div>

      {project && (
        <nav className={styles.tabbar} aria-label={t('shell.tabbar')}>
          <ul className={styles.tabs}>
            {SECTIONS.map((section) => (
              <li key={section}>
                <Link
                  href={projectHref(project.slug, section)}
                  className={styles.tab}
                  aria-current={section === active ? 'page' : undefined}
                >
                  <span className={styles.tabIcon}>{ICONS[section]}</span>
                  <span className={styles.tabLabel}>{t(`nav.${section}`)}</span>
                  <OpenCount section={section} glance={glance} t={t} place="tabbar" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  )
}
