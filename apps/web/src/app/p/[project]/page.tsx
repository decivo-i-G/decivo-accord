import { cssVariableName } from '@decivo/accord-cli'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { ButtonLink } from '@/components/button'
import { CommandLine, Snippet } from '@/components/command-line'
import { CopyButton } from '@/components/copy-button'
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Clock,
  Inbox,
  type SurfaceTool,
  ToolIcon,
  TriangleAlert,
} from '@/components/icons'
import { IncludeCodeButton } from '@/components/include-code-button'
import styles from '@/components/overview.module.css'
import {
  codeOutsideSentence,
  missedFolders,
  noCodeState,
  overviewSentence,
} from '@/components/overview-parts'
import { PageHeader } from '@/components/page-header'
import { Shell } from '@/components/shell'
import ui from '@/components/ui.module.css'
import type { SurfaceId } from '@/lib/data'
import type { Finding } from '@/lib/findings'
import { healthSummary } from '@/lib/findings'
import { type SurfaceLine, taskText } from '@/lib/overview'
import { loadOverview, type ProjectOverview } from '@/lib/overview-load'
import { loadRegisterOnce, overviewMetadata } from '@/lib/page-meta'
import { findProject, registerDirOf } from '@/lib/projects'
import { registerHref } from '@/lib/register-href'
import { missingCss } from '@/lib/register-view'
import { decisionHref, projectHref } from '@/lib/routes'

export const dynamic = 'force-dynamic'
export const generateMetadata = overviewMetadata

type T = Awaited<ReturnType<typeof getTranslations<'overview'>>>
type TH = Awaited<ReturnType<typeof getTranslations<'health'>>>
type TC = Awaited<ReturnType<typeof getTranslations<'connections'>>>
/** CSS lines per task id, for tasks whose step is to paste them (variables code does not have yet). */
type Snippets = ReadonlyMap<string, string>

const mark = (s: SurfaceId): SurfaceTool => (s === 'claude-design' ? 'claude_design' : s)
/** The section of a surface in the project settings (Verbindungen). */
const settingsAnchor = (s: SurfaceId) => mark(s)
/** How many tokens a task names before "und 3 weitere". */
const TASK_TOKENS = 8

type Key = Parameters<T>[0]

/** A task's title and its one sentence how, in plain text (for the screen and for copying). */
function taskWords(finding: Finding, t: T) {
  const { title, how, values } = taskText(finding)
  return { title: t(title as Key, values), how: t(how as Key, values) }
}

/** The developer's part of a task: the command or the file to edit. */
function devValue(finding: Finding): { value: string; kind: 'command' | 'file' } | undefined {
  const { action } = finding
  if (action.kind === 'command') return { value: action.command, kind: 'command' }
  if (action.kind === 'file') return { value: action.path, kind: 'file' }
  return undefined
}

/** The tokens a task is about, each a link to the token in the register. */
function TaskTokens({ finding, slug, t }: { finding: Finding; slug: string; t: T }) {
  const tokens = finding.tokens ?? []
  if (tokens.length === 0) return null
  const base = projectHref(slug, 'register')
  const shown = tokens.slice(0, TASK_TOKENS)
  return (
    <ul className={styles.taskTokens} aria-label={t('task.tokens')}>
      {shown.map((path) => (
        <li key={path}>
          <Link href={registerHref(base, { tab: 'tokens', item: path })} className={styles.tokenLink}>
            <code>{path}</code>
          </Link>
        </li>
      ))}
      {tokens.length > shown.length && (
        <li className={styles.tokenMore}>{t('task.moreTokens', { count: tokens.length - shown.length })}</li>
      )}
    </ul>
  )
}

/** The developer's part under a task: "Für Entwickler" and the command (or file) with a copy button. */
function ForDevelopers({ finding, t }: { finding: Finding; t: T }) {
  const dev = devValue(finding)
  if (!dev) return null
  return (
    <div className={styles.dev}>
      <p className={styles.devLabel}>{t('forDevelopers')}</p>
      <CommandLine command={dev.value} label={dev.kind === 'command' ? t('step.copy') : t('step.copyPath')} />
    </div>
  )
}

/**
 * One short item: what to do, as a task with a verb ("Gelöschten Token in Figma wiederherstellen").
 * Every item opens the same way ("So geht's") to one sentence, the tokens it names and, last, the
 * command for developers. Nothing on it is an icon without words.
 */
function TaskItem({
  finding,
  slug,
  t,
  snippets,
}: {
  finding: Finding
  slug: string
  t: T
  snippets: Snippets
}) {
  const words = taskWords(finding, t)
  const link = finding.action.kind === 'link' && finding.action.to === 'connections'
  const css = snippets.get(finding.id)
  return (
    <li>
      <details className={styles.task}>
        <summary className={styles.item}>
          <ToolIcon tool={mark(finding.surface)} />
          <span className={styles.itemTitle}>{words.title}</span>
          <span className={styles.taskOpen}>
            {t('task.open')}
            <ChevronDown aria-hidden="true" className={styles.taskChevron} />
          </span>
        </summary>
        <div className={styles.taskBody}>
          <p>{words.how}</p>
          {css ? (
            <Snippet code={css} label={t('task.copyCss')} />
          ) : (
            <TaskTokens finding={finding} slug={slug} t={t} />
          )}
          {link && (
            <Link href={projectHref(slug, 'connections')} className={styles.quietLink}>
              {t('step.connections')}
            </Link>
          )}
          <ForDevelopers finding={finding} t={t} />
        </div>
      </details>
    </li>
  )
}

/**
 * Code files with fixed values while decisions come first: one item in the words every screen uses
 * ("1 Datei mit fest eingetragenen Werten"), the file path in mono, and a link to it in the inbox.
 */
function FilesItem({
  files,
  slug,
  t,
  tc,
}: {
  files: NonNullable<NonNullable<ProjectOverview['overview']>['files']>
  slug: string
  t: T
  tc: TC
}) {
  return (
    <li className={styles.task}>
      <Link href={decisionHref(slug, files.id)} className={`${styles.item} ${styles.itemLink}`}>
        <ToolIcon tool="code" />
        <span className={styles.itemTitle}>
          {tc('state.files', { count: files.count })}
          {files.count === 1 && files.file && <code className={styles.itemPath}>{files.file}</code>}
        </span>
        <span className={styles.taskOpen}>
          {t('task.view')}
          <ChevronRight aria-hidden="true" />
        </span>
      </Link>
    </li>
  )
}

/** The screen's one primary action. */
function PrimaryStep({
  data,
  slug,
  t,
  tc,
  folders,
  snippets,
}: {
  data: ProjectOverview
  slug: string
  t: T
  tc: TC
  /** The folders Accord misses, as the language lists them ("app/ und components/"). */
  folders: string
  snippets: Snippets
}) {
  const arrow = <ArrowRight aria-hidden="true" />
  const step = data.overview?.step
  if (!step) return null
  switch (step.kind) {
    case 'decisions':
      return (
        <ButtonLink
          href={decisionHref(slug, step.id)}
          variant="primary"
          icon={<Inbox aria-hidden="true" />}
          iconAfter={arrow}
        >
          {t('step.decisions', { count: step.count })}
        </ButtonLink>
      )
    case 'review':
      return (
        <ButtonLink href={decisionHref(slug, step.id)} variant="primary" iconAfter={arrow}>
          {t('step.review', { files: step.files })}
        </ButtonLink>
      )
    case 'connect':
      // Code in folders Accord does not look in yet: one click adds them, no YAML to edit.
      if (data.missed)
        return (
          <IncludeCodeButton
            project={slug}
            configFile={data.missed.configFile}
            label={tc('include', { folders })}
          />
        )
      return (
        <ButtonLink href={`${projectHref(slug, 'connections')}#code`} variant="primary" iconAfter={arrow}>
          {tc('connect')}
        </ButtonLink>
      )
    case 'finding': {
      const { finding } = step
      const words = taskWords(finding, t)
      const dev = devValue(finding)
      const { action } = finding
      const css = snippets.get(finding.id)
      if (css)
        return (
          <div className={styles.stepTask}>
            <p className={styles.stepTitle}>{words.title}</p>
            <p>{words.how}</p>
            <Snippet code={css} label={t('task.copyCss')} />
          </div>
        )
      return (
        <div className={styles.stepTask}>
          <p className={styles.stepTitle}>{words.title}</p>
          <p>{words.how}</p>
          <TaskTokens finding={finding} slug={slug} t={t} />
          {dev ? (
            <>
              <div className={styles.stepCopy}>
                <CopyButton
                  value={`${words.title}\n${words.how}\n\n${dev.value}`}
                  text={t('step.devGuide')}
                  variant="primary"
                />
              </div>
              <ForDevelopers finding={finding} t={t} />
            </>
          ) : (
            <ButtonLink
              href={
                action.kind === 'proposal'
                  ? decisionHref(slug, action.id)
                  : projectHref(slug, action.kind === 'link' ? action.to : 'register')
              }
              variant="primary"
              iconAfter={arrow}
            >
              {action.kind === 'link' && action.to === 'connections'
                ? t('step.connections')
                : t('step.register')}
            </ButtonLink>
          )}
        </div>
      )
    }
    default:
      return (
        <ButtonLink
          href={projectHref(slug, 'register')}
          variant="primary"
          icon={<BookOpen aria-hidden="true" />}
          iconAfter={arrow}
        >
          {t('step.done')}
        </ButtonLink>
      )
  }
}

/**
 * One surface in one line, and the whole line is the link: its icon and name, its state in the words
 * Verbindungen uses for it (one name per state, with the count: "3 Entscheidungen warten"), and a
 * chevron. Waiting lines open the inbox at that surface's first decision, the others the surface's part
 * of the project settings.
 */
function SurfaceRow({
  line,
  data,
  slug,
  th,
  tc,
}: {
  line: SurfaceLine
  data: ProjectOverview
  slug: string
  th: TH
  tc: TC
}) {
  const { status } = line
  const tool = mark(line.id)
  const text =
    status.kind === 'setup'
      ? line.id === 'code' && status.state !== 'foundOff'
        ? noCodeState(data, tc)
        : status.state === 'foundOff'
          ? tc('state.foundOff')
          : tc(`state.${status.state}`, { tool })
      : status.kind === 'waiting' || status.kind === 'files' || status.kind === 'differs'
        ? tc(`state.${status.kind}`, { count: status.count })
        : tc('state.inSync')
  const href =
    status.kind === 'waiting' || status.kind === 'files'
      ? decisionHref(slug, status.id)
      : `${projectHref(slug, 'connections')}#${settingsAnchor(line.id)}`
  const tone =
    status.kind === 'inSync'
      ? styles.inSync
      : status.kind === 'waiting' || status.kind === 'files' || status.kind === 'differs'
        ? styles.waiting
        : styles.quiet
  return (
    <li className={styles.surfaceItem}>
      <Link href={href} className={styles.surface}>
        <span className={styles.surfaceName}>
          <ToolIcon tool={tool} />
          {th(`surfaces.${line.id}`)}
          <span className="visually-hidden">,</span>
        </span>
        <span className={`${styles.surfaceState} ${tone}`}>
          {status.kind === 'inSync' && <CircleCheck aria-hidden="true" />}
          {text}
        </span>
        <ChevronRight aria-hidden="true" className={styles.surfaceChevron} />
      </Link>
    </li>
  )
}

export default async function OverviewPage({ params }: { params: Promise<{ project: string }> }) {
  const project = findProject((await params).project)
  if (!project) return null
  const [t, th, tc, format] = await Promise.all([
    getTranslations('overview'),
    getTranslations('health'),
    getTranslations('connections'),
    getFormatter(),
  ])
  const data = await loadOverview(project)
  const { overview, health, proposals } = data
  const slug = project.slug

  // Variables code does not have yet: the step is to paste their lines, so the task carries them.
  const tasks = [
    ...(overview?.items ?? []),
    ...(overview?.more ?? []),
    ...(overview?.step.kind === 'finding' ? [overview.step.finding] : []),
  ]
  const missing = tasks.filter((f) => f.cause === 'missing' && f.tokens?.length)
  const register =
    missing.length > 0 ? await loadRegisterOnce(registerDirOf(project)).catch(() => undefined) : undefined
  const snippets = new Map<string, string>()
  for (const f of missing) {
    const css = register && missingCss(register, f.tokens ?? [], cssVariableName)
    if (css) snippets.set(f.id, css)
  }

  const more = overview?.more ?? []
  const summary = health ? healthSummary(health.report, proposals) : undefined
  // The cause belongs to the step that fixes it: only when connecting code is the one thing to do.
  const outside = overview?.step.kind === 'connect' ? codeOutsideSentence(data, t, format) : undefined
  const excluded = health
    ? [
        ...(health.report.code.inlineOnly.total > 0
          ? [th('excludedInline', { count: health.report.code.inlineOnly.total })]
          : []),
        ...(health.report.code.allowed.total > 0
          ? [th('excludedAllowed', { count: health.report.code.allowed.total })]
          : []),
      ]
    : []

  return (
    <Shell project={project} active="overview">
      <PageHeader title={t('title')} />

      <div className={styles.now}>
        <p className={styles.sentence}>{overviewSentence(data, t, tc)}</p>
        {outside && (
          <p className={styles.caution}>
            <TriangleAlert aria-hidden="true" />
            <span>{outside}</span>
          </p>
        )}
        {overview ? (
          <div className={styles.step}>
            <PrimaryStep
              data={data}
              slug={slug}
              t={t}
              tc={tc}
              folders={missedFolders(data, format)}
              snippets={snippets}
            />
          </div>
        ) : (
          <div className={styles.broken}>
            <p>{t('brokenHint')}</p>
            <CommandLine command="accord init" label={t('step.copy')} />
          </div>
        )}
      </div>

      {overview && (overview.items.length > 0 || overview.files) && (
        <section className={styles.block} aria-labelledby="items-h">
          <h2 id="items-h" className={styles.blockTitle}>
            {t('itemsTitle')}
          </h2>
          <ul className={styles.items}>
            {overview.files && <FilesItem files={overview.files} slug={slug} t={t} tc={tc} />}
            {overview.items.map((f) => (
              <TaskItem key={f.id} finding={f} slug={slug} t={t} snippets={snippets} />
            ))}
          </ul>
        </section>
      )}

      {overview && (
        <section className={styles.block} aria-labelledby="surfaces-h">
          <h2 id="surfaces-h" className={styles.blockTitle}>
            {t('surfacesTitle')}
          </h2>
          <ul className={styles.surfaces}>
            {overview.surfaces.map((line) => (
              <SurfaceRow key={line.id} line={line} data={data} slug={slug} th={th} tc={tc} />
            ))}
          </ul>
        </section>
      )}

      {health && summary && (
        <details className={`${ui.details} ${styles.details}`}>
          <summary>
            <ChevronRight aria-hidden="true" />
            {t('details')}
          </summary>
          <div className={styles.detailsBody}>
            <p className={styles.score}>
              {summary.measurable
                ? th('scoreSentence', { score: summary.score, band: summary.band })
                : th('scoreUnknown')}
            </p>
            {summary.measurable && (
              <>
                <p>{th('scoreParts')}</p>
                <dl className={styles.moved}>
                  {(['tokenSync', 'hardValues'] as const).map((part) => (
                    <div key={part}>
                      <dt>{th(`moved.${part}`)}</dt>
                      <dd>
                        <span className={styles.movedValue}>
                          {part === 'tokenSync'
                            ? th('moved.tokenSyncValue', { a: summary.inSync, b: summary.covered })
                            : th('moved.hardValuesValue', {
                                count: summary.hardColours,
                                files: summary.files,
                              })}
                        </span>
                        <span className={styles.movedPoints}>
                          {th('moved.points', { points: 50 - summary.parts[part].lost })}
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
                {summary.waiting > 0 && <p>{th('moved.waiting', { count: summary.waiting })}</p>}
                {excluded.length > 0 && (
                  <p>{th('excluded', { list: format.list(excluded, { type: 'conjunction' }) })}</p>
                )}
              </>
            )}

            {more.length > 0 && (
              <>
                <h2 className={styles.detailsTitle}>{t('tasksTitle')}</h2>
                <ul className={styles.items}>
                  {more.map((f) => (
                    <TaskItem key={f.id} finding={f} slug={slug} t={t} snippets={snippets} />
                  ))}
                </ul>
              </>
            )}

            <p className={`${ui.withIcon} ${styles.stamp}`}>
              <Clock aria-hidden="true" />
              {th('generatedAt', {
                date: format.dateTime(new Date(health.report.generatedAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })}
            </p>
          </div>
        </details>
      )}
    </Shell>
  )
}
