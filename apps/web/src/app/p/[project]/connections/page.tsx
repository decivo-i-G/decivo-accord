import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { CommandLine, Snippet } from '@/components/command-line'
import styles from '@/components/connections.module.css'
import { CopyValue } from '@/components/copy-button'
import { FocusTarget } from '@/components/focus-target'
import {
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleDot,
  FileText,
  ToolIcon,
  TriangleAlert,
} from '@/components/icons'
import { IncludeCodeButton } from '@/components/include-code-button'
import { Notice } from '@/components/notice'
import { PageHeader } from '@/components/page-header'
import { Shell } from '@/components/shell'
import { SurfaceSwitch } from '@/components/surface-switch'
import {
  type Agreement,
  agreementHref,
  agreementOf,
  type ConnectionRow,
  type ConnectionTool,
  connectionRow,
  connectionSummary,
  differingTokens,
  isConnected,
} from '@/lib/connection-rows'
import {
  type ConnectionsData,
  codeOutside,
  describeGlob,
  getConnections,
  globRoot,
  includeYaml,
  suggestInclude,
} from '@/lib/connections'
import { getHealth, type HealthData, type SurfaceId } from '@/lib/data'
import { nextAction } from '@/lib/findings'
import { overviewOf } from '@/lib/overview'
import { connectionsMetadata } from '@/lib/page-meta'
import { findProject } from '@/lib/projects'
import { isOpen, loadProjectProposals, type ProposalView } from '@/lib/proposals'

export const dynamic = 'force-dynamic'
export const generateMetadata = connectionsMetadata

type T = Awaited<ReturnType<typeof getTranslations<'connections'>>>
type Format = Awaited<ReturnType<typeof getFormatter>>

/** The same order as the overview's surface lines: the code first, then the design tools. */
const ORDER: ConnectionTool[] = ['code', 'figma', 'pen', 'claude_design']
/** How many found files show before the rest folds away. */
const VISIBLE_FILES = 4

const surfaceId = (tool: ConnectionTool): SurfaceId => (tool === 'claude_design' ? 'claude-design' : tool)

interface Context {
  slug: string
  data: ConnectionsData
  health?: HealthData | undefined
  proposals: readonly ProposalView[]
  now: Date
  t: T
  format: Format
}

const code = (chunks: ReactNode) => <code className={styles.inlinePath}>{chunks}</code>

/** A glob pattern in plain words: "all .ts, .tsx and .css files under src/". */
function globWords(pattern: string, t: T, format: Format): string | undefined {
  const meaning = describeGlob(pattern)
  if (!meaning) return undefined
  if (meaning.kind === 'file') return t('settings.glob.exact')
  // German hyphenates every ending but the last (".ts-, .tsx- und .css-Dateien"); English does not.
  const endings = meaning.extensions.map((ext, i, all) =>
    i < all.length - 1 ? t('settings.glob.ext', { ext }) : ext,
  )
  const exts = format.list(endings, { type: 'conjunction' })
  return meaning.root
    ? t('settings.glob.under', { exts, root: meaning.root })
    : t('settings.glob.anywhere', { exts })
}

/** What Accord read for a surface, and the folders it missed (code only). */
function facts(tool: ConnectionTool, ctx: Context) {
  const { data, health, proposals } = ctx
  if (tool === 'code') {
    const scanned = health?.report.code.filesScanned ?? 0
    const found =
      scanned === 0
        ? codeOutside(
            [
              ...data.code.css,
              ...(data.code.uiDir ? [data.code.uiDir] : []),
              ...data.code.tokens.map((x) => x.path),
            ],
            data.code.include,
          )
        : []
    const include = [...new Set(data.code.include.map(globRoot))].filter(Boolean)
    return {
      enabled: true,
      found: scanned,
      unreadable: false,
      outside: 0,
      missed: found.length > 0 ? { found, include } : undefined,
    }
  }
  if (tool === 'claude_design') {
    const found = proposals.filter((p) => p.tool === 'claude-design').length
    return { enabled: data.claudeDesign.enabled, found, unreadable: false, outside: 0, missed: undefined }
  }
  const s = tool === 'figma' ? data.figma : data.pen
  const found = s.files.length
  return {
    enabled: s.enabled,
    found,
    unreadable: Boolean(s.error) || (found > 0 && s.files.every((f) => f.errors.length > 0)),
    outside: s.outside.length,
    missed: undefined,
  }
}

/** Where a new file goes, as one path to copy (Figma: the copy of the whole file, no plugin needed). */
const NEW_FILE: Partial<Record<ConnectionTool, string>> = {
  figma: 'figma/design-system.fig',
  pen: 'design/app.pen',
}

/**
 * Is it connected, in words after one icon: a check for connected and in sync with the register, a
 * filled dot for connected but different (the sentence below says where), a dashed circle for not
 * yet, a warning for a problem. The check means "in sync" as on the overview. Only the icon is
 * coloured; the words carry the meaning.
 */
function StateLine({
  row,
  agreement,
  name,
  t,
}: {
  row: ConnectionRow
  agreement?: Agreement | undefined
  name: string
  t: T
}) {
  const { state } = row
  const connected = isConnected(row)
  const problem = state.kind === 'differs' || state.kind === 'unreadable'
  const text =
    row.next?.kind === 'codeOutside'
      ? t('state.notChecked')
      : state.kind === 'differs'
        ? t('state.differs', { count: state.count ?? 0 })
        : state.kind === 'unreadable'
          ? t('state.unreadable')
          : connected
            ? t('state.connected')
            : state.kind === 'foundOff'
              ? t('state.foundOff')
              : t(`state.${state.kind === 'noFiles' ? 'noFiles' : 'off'}`, { tool: row.tool })
  const look = problem
    ? { className: styles.problem, icon: <TriangleAlert aria-hidden="true" data-state="problem" /> }
    : connected && agreement?.kind === 'drift'
      ? { className: styles.differs, icon: <CircleDot aria-hidden="true" data-state="differs" /> }
      : connected
        ? { className: styles.inSync, icon: <CircleCheck aria-hidden="true" data-state="inSync" /> }
        : { className: styles.quiet, icon: <CircleDashed aria-hidden="true" data-state="off" /> }
  return (
    <p className={`${styles.state} ${look.className}`}>
      {look.icon}
      <span>
        <span className="visually-hidden">{`${name}: `}</span>
        {text}
      </span>
    </p>
  )
}

/** The one step to connect a surface, when it needs one: one sentence, and at most one thing to click. */
function NextStep({ row, name, ctx }: { row: ConnectionRow; name: string; ctx: Context }) {
  const { next } = row
  const { t, slug } = ctx
  if (!next) return null
  const id = `step-${row.tool}`
  if (next.kind === 'addFile') {
    const path = NEW_FILE[row.tool]
    // Claude Design has no file to place: a developer imports the handoff with one command.
    const add = path
      ? {
          text: row.tool === 'figma' ? t('step.figmaFig') : t('add.pen'),
          value: path,
          label: t('copyPath'),
          later: t('step.later'),
        }
      : {
          text: t('claudeDesign.step'),
          value: `accord ingest <${t('commands.bundle')}> --write`,
          label: t('claudeDesign.copy'),
          later: t('claudeDesign.later'),
        }
    return (
      <div className={styles.addFile}>
        <p className={styles.step} id={id}>
          {add.text}
        </p>
        <CopyValue
          value={add.value}
          label={add.label}
          className={styles.copyPath}
          textClassName={styles.copyPathText}
        />
        <p className={styles.later}>{add.later}</p>
      </div>
    )
  }
  if (next.kind === 'codeOutside')
    // One click adds the folders to the config; which ones, and the YAML, stay under "For developers".
    return (
      <div className={styles.stepAction}>
        {/* Secondary: a settings page has no primary, the overview carries this step as its one. */}
        <IncludeCodeButton
          project={slug}
          configFile={ctx.data.configFile}
          label={t('includeAll')}
          note={t('includeNote')}
          variant="secondary"
        />
      </div>
    )
  const text =
    next.kind === 'switchOn'
      ? t('switchOn', { tool: name })
      : next.kind === 'outside'
        ? t('outside', { count: next.count })
        : t(`reason.${next.reason}`, { tool: name })
  return (
    <p className={styles.step} id={id}>
      {text}
    </p>
  )
}

/** A list of found files: the first few, the rest behind a disclosure. */
function Files({ files, t }: { files: { path: string; meta?: ReactNode; problem?: ReactNode }[]; t: T }) {
  const list = (items: typeof files) => (
    <ul className={styles.files}>
      {items.map((f) => (
        <li key={f.path} className={styles.file}>
          <FileText aria-hidden="true" className={styles.fileIcon} />
          <div className={styles.fileText}>
            <code className={styles.path}>{f.path}</code>
            {f.meta && <span className={styles.fileMeta}>{f.meta}</span>}
            {f.problem && <span className={styles.fileProblem}>{f.problem}</span>}
          </div>
        </li>
      ))}
    </ul>
  )
  const rest = files.slice(VISIBLE_FILES)
  return (
    <>
      {list(files.slice(0, VISIBLE_FILES))}
      {rest.length > 0 && (
        <details className={styles.more}>
          <summary>
            <ChevronRight aria-hidden="true" />
            {t('found.more', { count: rest.length })}
          </summary>
          {list(rest)}
        </details>
      )}
    </>
  )
}

/**
 * Paths, patterns, Figma's mode rule and the commands for one surface: a section inside the page's one
 * "For developers" disclosure.
 */
function Developer({
  tool,
  ctx,
  missed,
}: {
  tool: ConnectionTool
  ctx: Context
  missed?: string[] | undefined
}) {
  const { data, proposals, t, format, slug } = ctx
  const config = data.configFile
  const headingId = `dev-${tool}`
  const include = (patterns: string[]) => {
    const words = patterns.map((p) => globWords(p, t, format)).filter((w): w is string => Boolean(w))
    return (
      <>
        <span className={styles.globs}>
          {patterns.map((p) => (
            <code key={p} className={styles.glob}>
              {p}
            </code>
          ))}
        </span>
        {words.length > 0 && (
          <span className={styles.settingNote}>{format.list(words, { type: 'conjunction' })}</span>
        )}
      </>
    )
  }

  let found: ReactNode
  let fix: ReactNode
  let other: ReactNode
  const settings: { label: string; value: ReactNode }[] = []
  let commands: { command: string; text: string }[]
  const folder = `<${t('commands.folder')}>`
  const bundle = `<${t('commands.bundle')}>`

  if (tool === 'code') {
    const c = data.code
    const groups = [
      { label: t('found.stylesheets'), items: c.css },
      { label: t('found.uiKit'), items: c.uiDir ? [c.uiDir] : [] },
      { label: t('found.tokens'), items: c.tokens.map((x) => x.path) },
      { label: t('found.designMd'), items: c.designMd },
      { label: t('found.storybook'), items: c.storybook ? ['.storybook'] : [] },
    ].filter((g) => g.items.length > 0)
    found =
      groups.length === 0 ? (
        <p className={styles.muted}>{t('found.none')}</p>
      ) : (
        <dl className={styles.groups}>
          {groups.map((g) => (
            <div key={g.label}>
              <dt>{g.label}</dt>
              <dd>
                <Files files={g.items.map((path) => ({ path }))} t={t} />
              </dd>
            </div>
          ))}
        </dl>
      )
    if (missed && missed.length > 0)
      fix = (
        <div className={styles.block}>
          <p>{t.rich('dev.codeOutside', { file: config, code })}</p>
          <Snippet code={includeYaml(suggestInclude(c.include, missed))} label={t('dev.copyYaml')} />
        </div>
      )
    settings.push({ label: t('settings.include'), value: include(c.include) })
    settings.push({
      label: t('dev.register'),
      value: <code className={styles.path}>{`${data.registerDir}/`}</code>,
    })
    commands = [
      { command: 'accord diff', text: t('commands.code.diff') },
      { command: `accord check <${t('commands.path')}>`, text: t('commands.code.check') },
      { command: 'accord export', text: t('commands.code.export') },
    ]
  } else if (tool === 'figma' || tool === 'pen') {
    const s = tool === 'figma' ? data.figma : data.pen
    const problem = (errors: string[]) =>
      errors.length > 0 ? (
        <>
          {t('found.unreadable')} <code>{errors[0]}</code>
        </>
      ) : undefined
    found =
      s.error !== undefined ? (
        <Notice tone="warning" title={t('found.error')}>
          <code className={styles.path}>{s.error}</code>
        </Notice>
      ) : s.files.length === 0 ? (
        <p className={styles.muted}>{t('found.none')}</p>
      ) : (
        <Files
          t={t}
          files={
            tool === 'figma'
              ? data.figma.files.map((f) => ({
                  path: f.path,
                  meta: [
                    t('found.format', { format: f.format.replaceAll('-', '_') }),
                    t('found.variables', { count: f.variables }),
                    ...(f.modes.length > 0 ? [t('found.modes', { modes: f.modes.join(', ') })] : []),
                  ].join(' · '),
                  problem: problem(f.errors),
                }))
              : data.pen.files.map((f) => ({
                  path: f.path,
                  meta: [
                    t('found.variables', { count: f.variables }),
                    ...(f.themes.length > 0 ? [t('found.themes', { themes: f.themes.join('; ') })] : []),
                  ].join(' · '),
                  problem: problem(f.errors),
                }))
          }
        />
      )
    if (s.outside.length > 0)
      fix = (
        <p className={styles.block}>
          {t('dev.outside', {
            count: s.outside.length,
            files: s.outside.slice(0, 3).join(', '),
            config,
            key: `surfaces.${tool}.include`,
          })}
        </p>
      )
    settings.push({ label: t('settings.include'), value: include(s.include) })
    if (tool === 'figma') {
      // The row shows the way without a plugin; the variables export is the other way in.
      other = (
        <section className={styles.block} aria-labelledby={`${headingId}-json`}>
          <h4 id={`${headingId}-json`} className={styles.label}>
            {t('dev.figmaJson')}
          </h4>
          <p className={styles.note}>{t.rich('add.figma', { code })}</p>
        </section>
      )
      const modes = [...new Set(data.figma.files.flatMap((f) => f.modes))]
      settings.push({
        label: t('settings.defaultMode'),
        value: (
          <>
            <span>{data.figma.defaultMode ?? t('settings.defaultModeAuto')}</span>
            {modes.length > 0 && (
              <span className={styles.settingNote}>
                {t('settings.modesFound', { modes: modes.join(', ') })}
              </span>
            )}
          </>
        ),
      })
    }
    commands = [
      { command: `accord ${tool} status`, text: t(`commands.${tool}.status`) },
      { command: `accord ${tool} propose --write`, text: t(`commands.${tool}.propose`) },
      { command: `accord ${tool} lock`, text: t(`commands.${tool}.lock`) },
    ]
  } else {
    const handoffs = proposals.filter((p) => p.tool === 'claude-design')
    const open = handoffs.filter((p) => p.group !== 'decided').length
    const last = [...handoffs].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')).at(-1)
    found =
      handoffs.length === 0 ? (
        <p className={styles.muted}>{t('found.none')}</p>
      ) : (
        <p className={styles.handoffs}>
          <span>{t('found.handoffs', { count: handoffs.length, open })}</span>
          {last?.handoff && (
            <span className={styles.fileMeta}>{t('found.lastHandoff', { name: last.handoff.name })}</span>
          )}
        </p>
      )
    if (data.claudeDesign.enabled) fix = <p className={styles.note}>{t.rich('dev.mirror', { code })}</p>
    // The project switch lives here: handoffs arrive either way, so the row itself needs no switch.
    settings.push({
      label: t('dev.project'),
      value: (
        <>
          <SurfaceSwitch
            project={slug}
            tool="claude_design"
            name={t('name.claude_design')}
            enabled={data.claudeDesign.enabled}
            configFile={config}
          />
          <span className={styles.settingNote}>{t('dev.handoffs')}</span>
        </>
      ),
    })
    settings.push({
      label: t('settings.project'),
      value: (
        <>
          <span>{data.claudeDesign.project ?? t('settings.projectNone')}</span>
          <span className={styles.settingNote}>
            {t.rich('commands.configKey', { file: config, key: 'surfaces.claude_design.project', code })}
          </span>
        </>
      ),
    })
    commands = [
      { command: `accord ingest ${bundle} --write`, text: t('commands.claude_design.ingest') },
      { command: `accord design status --mirror ${folder}`, text: t('commands.claude_design.status') },
      { command: `accord design reset --mirror ${folder}`, text: t('commands.claude_design.reset') },
      { command: `accord design lock --mirror ${folder}`, text: t('commands.claude_design.lock') },
    ]
  }

  return (
    <section className={styles.devSection} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.devName}>
        <ToolIcon tool={tool} aria-hidden="true" />
        {t(`name.${tool}`)}
      </h3>
      <div className={styles.devBody}>
        {fix}
        <section className={styles.block} aria-labelledby={`${headingId}-found`}>
          <h4 id={`${headingId}-found`} className={styles.label}>
            {t('found.title')}
          </h4>
          {found}
        </section>
        {other}
        <dl className={styles.settings}>
          {settings.map((s) => (
            <div key={s.label}>
              <dt>{s.label}</dt>
              <dd>{s.value}</dd>
            </div>
          ))}
        </dl>
        <section className={styles.block} aria-labelledby={`${headingId}-commands`}>
          <h4 id={`${headingId}-commands`} className={styles.label}>
            {t('commands.title')}
          </h4>
          <ul className={styles.commands}>
            {commands.map((c) => (
              <li key={c.command}>
                <span>{c.text}</span>
                <CommandLine command={c.command} label={t('commands.copy')} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  )
}

/** A surface's row: what Accord found for it and its state, worked out once for the row and the lead. */
function rowOf(tool: ConnectionTool, ctx: Context, overview?: ReturnType<typeof overviewOf>) {
  const { health, proposals } = ctx
  const id = surfaceId(tool)
  const f = facts(tool, ctx)
  const surface = health?.surfaces[id]
  const row = connectionRow({
    tool,
    line: overview?.surfaces.find((l) => l.id === id),
    enabled: f.enabled,
    found: f.found,
    unreadable: f.unreadable,
    outside: f.outside,
    missed: f.missed,
    action: surface ? nextAction(surface, proposals, health?.report) : undefined,
  })
  // Figma and Pencil: the token paths where they differ, from their status and their open decisions.
  const differing =
    surface && (tool === 'figma' || tool === 'pen')
      ? differingTokens(
          surface.items,
          proposals.filter((p) => p.tool === id && isOpen(p)),
        )
      : undefined
  return { row, f, surface, agreement: agreementOf(row, differing) }
}

/**
 * One surface in one row: name, whether it is connected, one sentence under it (does it match the
 * register, how fresh the comparison is and what Accord reads), the switch (Figma and Pencil, once
 * there is a file or while on) and the one step to connect it. The switch sits in the row's text with
 * a visible label, so there is no column that changes its meaning from row to row. The code and Claude
 * Design's handoffs are always compared; their sentence says so.
 */
function SurfaceRow({
  tool,
  ctx,
  rowData,
}: {
  tool: ConnectionTool
  ctx: Context
  rowData: ReturnType<typeof rowOf>
}) {
  const { data, slug, t } = ctx
  const { row, f, agreement } = rowData
  const name = t(`name.${tool}`)
  const headingId = `surface-${tool}`
  const canSwitch = (tool === 'figma' || tool === 'pen') && (f.found > 0 || f.enabled)

  return (
    <li className={styles.row} id={tool}>
      <h2 id={headingId} className={styles.name}>
        <ToolIcon tool={tool} aria-hidden="true" />
        {name}
      </h2>
      <div className={styles.body}>
        <StateLine row={row} agreement={agreement} name={name} t={t} />
        <p className={styles.sub}>
          <SubLine tool={tool} ctx={ctx} rowData={rowData} />
        </p>
        <NextStep row={row} name={name} ctx={ctx} />
        {canSwitch && (
          <div className={styles.switchRow}>
            <SurfaceSwitch
              project={slug}
              tool={tool}
              name={name}
              enabled={f.enabled}
              configFile={data.configFile}
              describedBy={row.next?.kind === 'switchOn' ? `step-${tool}` : undefined}
            />
          </div>
        )}
      </div>
    </li>
  )
}

/**
 * The one sentence under the state. Not connected: what Accord reads. Connected: whether it matches
 * the register and when it was last compared ("Stimmt mit dem Register überein, zuletzt abgeglichen
 * vor 6 Tagen."), where it differs as a link to the inbox filtered to that surface, and for Figma
 * and Pencil what Accord read in a designer's words (variables, and which Figma mode is compared).
 */
function SubLine({
  tool,
  ctx,
  rowData,
}: {
  tool: ConnectionTool
  ctx: Context
  rowData: ReturnType<typeof rowOf>
}) {
  const { proposals, now, t, format, slug } = ctx
  const { row, surface, agreement } = rowData
  if (row.next?.kind === 'codeOutside') return t('codeOutsidePlain')
  if (!agreement) return t(`how.${tool}`)

  const lastHandoff = proposals
    .filter((p) => p.tool === 'claude-design' && p.createdAt)
    .map((p) => p.createdAt as string)
    .sort()
    .at(-1)
  const syncedAt = surface?.syncedAt ?? (tool === 'claude_design' ? lastHandoff : undefined)
  const sync =
    tool === 'code'
      ? t('compare.when.live')
      : syncedAt
        ? t(tool === 'claude_design' && !surface?.syncedAt ? 'compare.when.handoff' : 'compare.when.at', {
            when: format.relativeTime(new Date(syncedAt), now),
          })
        : t('compare.when.never')
  const href = agreementHref(slug, tool, agreement)
  const state =
    agreement.kind === 'inSync'
      ? t('compare.inSync', { sync })
      : t.rich('compare.drift', {
          unit: agreement.unit,
          count: agreement.count,
          sync,
          link: (chunks) =>
            href ? (
              <Link href={href} className={styles.subLink}>
                {chunks}
              </Link>
            ) : (
              chunks
            ),
        })
  const read = readWords(tool, ctx)
  return (
    <>
      {state}
      {read && ` ${read}`}
    </>
  )
}

/**
 * What Accord read from Figma or Pencil, in a designer's words: how many variables, and for Figma which
 * of its modes is compared ("Light"). The file paths are under "For developers".
 */
function readWords(tool: ConnectionTool, ctx: Context): string | undefined {
  const { data, health, t, format } = ctx
  if (tool !== 'figma' && tool !== 'pen') return undefined
  const files: { variables: number; modes?: string[] }[] =
    tool === 'figma' ? data.figma.files : data.pen.files
  if (files.length === 0) return undefined
  const variables = t('found.variables', { count: files.reduce((sum, f) => sum + f.variables, 0) })
  const modes = [...new Set(files.flatMap((f) => f.modes ?? []))]
  const mode = tool === 'figma' ? health?.surfaces.figma.defaultMode : undefined
  return modes.length > 1 && mode
    ? t('compare.modes', { variables, modes: format.list(modes, { type: 'conjunction' }), mode })
    : t('compare.variables', { variables })
}

export default async function ConnectionsPage({ params }: { params: Promise<{ project: string }> }) {
  const project = findProject((await params).project)
  if (!project) return null
  const [t, format] = await Promise.all([getTranslations('connections'), getFormatter()])
  const [data, health, proposals] = await Promise.all([
    getConnections(project),
    getHealth(project).catch(() => undefined),
    loadProjectProposals(project).catch(() => []),
  ])
  const ctx: Context = { slug: project.slug, data, health, proposals, now: new Date(), t, format }
  const overview = health
    ? overviewOf({ report: health.report, surfaces: health.surfaces, proposals })
    : undefined
  const rows = ORDER.map((tool) => ({ tool, ...rowOf(tool, ctx, overview) }))

  // The lead is the state at a glance: which surfaces are connected and which are not yet.
  const summary = connectionSummary(rows.map((r) => r.row))
  const names = (tools: ConnectionTool[]) =>
    format.list(
      tools.map((tool) => t(`name.${tool}`)),
      { type: 'conjunction' },
    )
  const lead =
    summary.kind === 'some'
      ? t('summary.some', {
          connected: names(summary.connected),
          missing: names(summary.missing),
          count: summary.connected.length,
        })
      : t(`summary.${summary.kind}`)

  const missed = facts('code', ctx).missed?.found
  return (
    <Shell project={project} active="connections">
      <PageHeader title={t('title')} lead={lead} />
      <FocusTarget scope="surfaces" />
      <ul className={styles.list} id="surfaces">
        {rows.map(({ tool, ...rowData }) => (
          <SurfaceRow key={tool} tool={tool} ctx={ctx} rowData={rowData} />
        ))}
      </ul>
      {/* One disclosure for every path, pattern and command, below the rows instead of one per row. */}
      <details className={styles.dev}>
        <summary>
          <ChevronRight aria-hidden="true" />
          <h2 className={styles.devTitle}>{t('dev.title')}</h2>
        </summary>
        <div className={styles.devAll}>
          {ORDER.map((tool) => (
            <Developer key={tool} tool={tool} ctx={ctx} missed={tool === 'code' ? missed : undefined} />
          ))}
        </div>
      </details>
    </Shell>
  )
}
