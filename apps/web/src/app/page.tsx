import type { Metadata } from 'next'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { CommandLine } from '@/components/command-line'
import styles from '@/components/home.module.css'
import { ArrowRight, CircleDashed, GitBranch, type SurfaceTool, ToolIcon } from '@/components/icons'
import { Onboarding } from '@/components/onboarding'
import { overviewSentence, stepLink } from '@/components/overview-parts'
import { PageHeader } from '@/components/page-header'
import { DisclosureSummary } from '@/components/proposal-parts'
import { Shell } from '@/components/shell'
import { Swatch } from '@/components/swatch'
import type { SurfaceId } from '@/lib/data'
import { lastChangeOf, type PaletteColour, paletteOf } from '@/lib/home'
import { loadOverview, type ProjectOverview } from '@/lib/overview-load'
import { loadRegisterOnce } from '@/lib/page-meta'
import { listProjects, type Project, registerDirOf } from '@/lib/projects'
import { visibleTokens } from '@/lib/register-view'
import { projectHref } from '@/lib/routes'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  // The root layout's title template only applies to child segments, not to its own page.
  return { title: { absolute: `${(await getTranslations('home'))('title')} · decivo Accord` } }
}

type T = Awaited<ReturnType<typeof getTranslations<'home'>>>
type TO = Awaited<ReturnType<typeof getTranslations<'overview'>>>
type TC = Awaited<ReturnType<typeof getTranslations<'connections'>>>
type TH = Awaited<ReturnType<typeof getTranslations<'health'>>>
type Format = Awaited<ReturnType<typeof getFormatter>>

const mark = (s: SurfaceId): SurfaceTool => (s === 'claude-design' ? 'claude_design' : s)

interface Row {
  project: Project
  data: ProjectOverview
  /** The register's colours, like a file thumbnail in Figma's file browser. */
  palette: PaletteColour[]
  /** The register's size, so two projects are told apart at a glance (111 tokens vs 9). */
  size?: { tokens: number; components: number } | undefined
}

/** The usual default branches: the row names a branch only when it is another one. */
const DEFAULT_BRANCHES = new Set(['main', 'master'])

async function rowOf(project: Project): Promise<Row> {
  const [data, register] = await Promise.all([
    loadOverview(project),
    loadRegisterOnce(registerDirOf(project)).catch(() => undefined),
  ])
  return {
    project,
    data,
    palette: register ? paletteOf(register) : [],
    size: register
      ? { tokens: visibleTokens(register).length, components: register.components.size }
      : undefined,
  }
}

/**
 * Which surfaces feed the project, in one muted line under the sentence: each surface by icon and name,
 * a dashed circle and quieter ink when it is not connected, then when anything last happened. Shape and
 * a hidden word carry the state, never colour alone.
 */
function SurfacesLine({ data, t, th, format }: { data: ProjectOverview; t: T; th: TH; format: Format }) {
  const lines = data.overview?.surfaces ?? []
  if (lines.length === 0) return null
  const last = lastChangeOf({ proposals: data.proposals, surfaces: data.health?.surfaces })
  return (
    <div className={styles.feeds}>
      <ul className={styles.surfaces} aria-label={t('surfaces')}>
        {lines.map((line) => {
          const on = line.status.kind !== 'setup'
          return (
            <li key={line.id} className={on ? styles.on : styles.off}>
              {on ? <ToolIcon tool={mark(line.id)} /> : <CircleDashed aria-hidden="true" />}
              {th(`surfaces.${line.id}`)}
              <span className="visually-hidden">, {on ? t('connected') : t('notConnected')}</span>
            </li>
          )
        })}
      </ul>
      {last && (
        <p className={styles.when}>
          <time dateTime={last.toISOString()}>
            {t('lastChange', { when: format.relativeTime(last, new Date()) })}
          </time>
        </p>
      )}
    </div>
  )
}

/**
 * One project as a row of the list, in the overview's calm logic: its name with branch and colours,
 * the state in one sentence with the surfaces that feed it, and one action named by its verb.
 */
function ProjectRow({
  row,
  t,
  to,
  tc,
  th,
  format,
}: {
  row: Row
  t: T
  to: TO
  tc: TC
  th: TH
  format: Format
}) {
  const { project, data, palette, size } = row
  const step = stepLink(project.slug, data)
  // Code in folders Accord does not look in: the row only leads to the overview, which offers the
  // one click next to the sentence that says what it changes. The list itself never writes config.
  const href = step.kind === 'connect' && data.missed ? projectHref(project.slug) : step.href
  return (
    <li className={styles.row}>
      <div className={styles.who}>
        <h2 className={styles.name}>
          <Link href={projectHref(project.slug)} className={styles.link}>
            {project.name}
          </Link>
        </h2>
        {size && <span className={styles.meta}>{t('size', size)}</span>}
        {!DEFAULT_BRANCHES.has(project.branch) && (
          <span className={styles.meta}>
            <GitBranch aria-hidden="true" />
            {t('branch', { branch: project.branch })}
          </span>
        )}
        {palette.length > 0 && (
          <span className={styles.swatches} aria-hidden="true">
            {palette.map((c) => (
              <span key={c.css} title={`${c.name} ${c.hex}`} className={styles.swatchTip}>
                <Swatch color={c.css} size="sm" />
              </span>
            ))}
          </span>
        )}
      </div>

      <div className={styles.state}>
        <p className={styles.sentence}>{overviewSentence(data, to, tc)}</p>
        <SurfacesLine data={data} t={t} th={th} format={format} />
        {!data.overview && (
          <div className={styles.raised}>
            <p className={styles.muted}>{to('brokenHint')}</p>
            <CommandLine command="accord init" label={to('step.copy')} />
          </div>
        )}
      </div>

      {data.overview && (
        <div className={styles.side}>
          <Link href={href} className={styles.go}>
            {t(`go.${step.kind}`)}
            <span className="visually-hidden">{` (${project.name})`}</span>
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      )}
    </li>
  )
}

export default async function Home() {
  const [t, to, tc, th, format] = await Promise.all([
    getTranslations('home'),
    getTranslations('overview'),
    getTranslations('connections'),
    getTranslations('health'),
    getFormatter(),
  ])
  const projects = listProjects()
  const rows = await Promise.all(projects.map(rowOf))

  return (
    <Shell>
      <PageHeader title={t('title')} lead={projects.length > 0 ? t('lead') : undefined} />
      {projects.length === 0 ? (
        <Onboarding />
      ) : (
        <>
          <ul className={styles.list} aria-label={t('listLabel')}>
            {rows.map((row) => (
              <ProjectRow key={row.project.slug} row={row} t={t} to={to} tc={tc} th={th} format={format} />
            ))}
          </ul>
          {/* Configuration, not a task: how another repository gets here, closed by default. */}
          <details className={styles.dev}>
            <DisclosureSummary>{t('dev')}</DisclosureSummary>
            <p className={styles.add}>{t.rich('add', { code: (chunks) => <code>{chunks}</code> })}</p>
          </details>
        </>
      )}
    </Shell>
  )
}
