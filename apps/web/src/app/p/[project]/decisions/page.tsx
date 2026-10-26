import { type ColorValue, colorToCss } from '@decivo/accord-core'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { ButtonLink } from '@/components/button'
import { CopyButton } from '@/components/copy-button'
import { EmptyState } from '@/components/empty-state'
import { ChevronRight, Info, X } from '@/components/icons'
import { InboxKeys, ShortcutSheet } from '@/components/inbox-keys'
import { Notice } from '@/components/notice'
import { PageHeader } from '@/components/page-header'
import { Inspector, PanelLayout, PropertyList } from '@/components/panel'
import {
  BulkAdopt,
  DecisionButtons,
  DecisionProvider,
  HandoffNames,
  OpenNames,
  UndoDecision,
} from '@/components/proposal-decision'
import {
  type ChangeImpact,
  ChangePreview,
  colorLabel,
  DisclosureSummary,
  DraftColors,
  HandoffGlance,
  Impact,
  type Num,
  Rich,
  RowPreview,
  RuleCard,
  SummaryText,
  type T,
  ToolTile,
} from '@/components/proposal-parts'
import styles from '@/components/proposals.module.css'
import { Shell } from '@/components/shell'
import { StatusChip, type Tone } from '@/components/status-chip'
import ui from '@/components/ui.module.css'
import { getHealth } from '@/lib/data'
import { adoptPreview, defaultDecider, undoOf } from '@/lib/decide'
import { impactOf, usesOf } from '@/lib/impact'
import { decisionsMetadata, loadRegisterOnce } from '@/lib/page-meta'
import { findProject, registerDirOf } from '@/lib/projects'
import {
  decisionCopyOf,
  type InboxGroup,
  inboxCounts,
  isOpen,
  loadProjectInbox,
  type Option,
  type ProposalView,
  type RuleView,
  recommendationOf,
  selectArg,
} from '@/lib/proposals'
import { decisionSourceOf, decisionsHref, projectHref, withDecision } from '@/lib/routes'

export const dynamic = 'force-dynamic'
export const generateMetadata = decisionsMetadata

const GROUPS: InboxGroup[] = ['needsYou', 'auto', 'code', 'decided']
/** Groups that are not decided here (or not any more): folded away under the open ones. */
const FOLDED: InboxGroup[] = ['code', 'decided']
/** How many new handoff colours can be named here; the rest go through a resolution file. */
const NAMEABLE = 8
/** Text contrast (WCAG AA): below it, a contrast change is worth showing before deciding. */
const MIN_CONTRAST = 4.5

/** One rule per decision (handoffs list every colour that breaks it). */
function byDecision(rules: RuleView[]): RuleView[] {
  const out = new Map<string, RuleView & { values: Set<string> }>()
  for (const r of rules) {
    const entry = out.get(r.decision) ?? { ...r, count: 0, values: new Set<string>() }
    entry.count += r.count
    entry.values.add(r.value)
    out.set(r.decision, entry)
  }
  return [...out.values()].map(({ values, ...r }) =>
    values.size > 1
      ? {
          ...r,
          value: [...values].slice(0, 3).join(', ') + (values.size > 3 ? ' …' : ''),
          nearest: undefined,
        }
      : r,
  )
}

/**
 * The one chip a row may carry: what was decided, or the one risk that makes a decision weigh more
 * (a deletion, a breaking change, a conflict). Broken rules are named in the details, not here.
 */
function rowChip(p: ProposalView, t: T): ReactNode {
  if (p.decision) {
    const tone: Tone = p.decision.option === 'adopt' ? 'success' : 'neutral'
    return <StatusChip tone={tone}>{t(`state.${p.decision.option}`)}</StatusChip>
  }
  if (p.risk.deletion) return <StatusChip tone="danger">{t('risk.deletion')}</StatusChip>
  if (p.risk.breaking) return <StatusChip tone="warning">{t('risk.breaking')}</StatusChip>
  if (p.risk.conflict) return <StatusChip tone="warning">{t('risk.conflict')}</StatusChip>
  return null
}

export default async function ProposalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>
  searchParams: Promise<{ id?: string; source?: string }>
}) {
  const project = findProject((await params).project)
  if (!project) return null
  const tp = await getTranslations('proposals')
  const t: T = (key, values) => tp(key as Parameters<typeof tp>[0], values as never)
  const format = await getFormatter()
  const now = new Date()
  const { proposals: all, unreadable } = await loadProjectInbox(project)
  const query = await searchParams
  const wanted = query.id
  // `?source=figma`: only the decisions from one surface (the links on Verbindungen). An unknown value
  // is no filter.
  const source = decisionSourceOf(query.source)
  const proposals = source ? all.filter((p) => p.tool === source) : all
  const open = proposals.filter(isOpen)
  // Filtered to code, there is nothing to decide here: the first file in code is what to look at.
  const selected =
    proposals.find((p) => p.id === wanted) ??
    open[0] ??
    (source === 'code' ? proposals.find((p) => p.group === 'code') : undefined)
  const num: Num = (value, options) =>
    options ? format.number(value, options as never) : format.number(value)
  const [register, health] = await Promise.all([
    loadRegisterOnce(registerDirOf(project)).catch(() => undefined),
    getHealth(project).catch(() => undefined),
  ])
  const scanned = Boolean(health && health.report.code.filesScanned > 0)
  const usage = health?.report.code.tokenUsage
  const by = await defaultDecider(project)
  const ratio = (n: number) => `${format.number(n, { maximumFractionDigits: 1 })}:1`
  // The list's own address: every link in it keeps the filter.
  const base = decisionsHref(project.slug, source)
  const href = (id: string) => withDecision(base, id)
  // How old the proposal is (when it arrived), the same before and after deciding; the decision's own
  // time is in its note.
  const age = (p: ProposalView) => {
    const at = p.createdAt
    const date = at ? new Date(at) : undefined
    return date && !Number.isNaN(date.getTime())
      ? { iso: date.toISOString(), text: format.relativeTime(date, now) }
      : undefined
  }
  const counts = inboxCounts(proposals)
  // Inbox zero without anything to compare yet is not an achievement: point to Connections instead.
  const surfacesFound = Boolean(
    health &&
      (health.surfaces.figma.files.length > 0 ||
        health.surfaces.pen.files.length > 0 ||
        all.some((p) => p.tool === 'claude-design')),
  )
  // Inbox zero names only the surfaces this project has, and the files still waiting in code.
  const tools = [
    health && health.surfaces.figma.files.length > 0 ? tp('tool.figma') : undefined,
    health && health.surfaces.pen.files.length > 0 ? tp('tool.pen') : undefined,
    all.some((p) => p.tool === 'claude-design') ? tp('tool.claude-design') : undefined,
  ].filter((x): x is string => Boolean(x))
  const toolList = format.list(
    tools.length > 0 ? tools : [tp('tool.figma'), tp('tool.pen'), tp('tool.claude-design')],
    { type: 'conjunction' },
  )
  const codeTasks = proposals.filter((p) => p.group === 'code')
  const tokenValueOf = (token: string) => {
    const v = register?.tokens.get(token)
    return v?.type === 'color' && v.value ? colorToCss(v.value as ColorValue) : undefined
  }

  // --- Inspector ---------------------------------------------------------------------------------
  // Order of the details: what changed (visual), why it is here (one sentence with the rule's name),
  // then everything else behind "Details". The suggestion and its one primary button sit in the footer.
  let inspector: ReactNode
  if (selected) {
    const openDecision = selected.decidable && !selected.decision
    const preview =
      openDecision && selected.kind === 'surface' ? await adoptPreview(project, selected.id) : undefined
    const blocked = preview && !preview.ok && preview.code === 'must_violation' ? preview.detail : undefined
    const at = selected.id ? open.findIndex((p) => p.id === selected.id) : -1
    const after = open.filter((p, i) => p.decidable && p.id !== selected.id && i > at)
    // After the last one, back to the top: the quickest decision that is still open.
    const next = after[0] ?? open.find((p) => p.decidable && p.id !== selected.id)
    const when = age(selected)
    const rules = byDecision(selected.rules)
    const newColors = selected.colors.filter((c) => c.match === 'new')
    const nearColors = selected.colors.filter((c) => c.match === 'near')
    const removed = selected.changes.filter((c) => c.kind === 'remove').map((c) => c.token)
    const removedUses =
      register && removed.length > 0 && scanned ? usesOf(register, removed, usage) : undefined
    const recommendation = recommendationOf(selected, removedUses, tokenValueOf)
    const adopted = selected.decision?.option === 'adopt'
    const undo = selected.decision && selected.decidable ? undoOf(project, selected.id) : undefined
    const impactFor = (c: (typeof selected.changes)[number]): ChangeImpact | undefined => {
      if (!register || c.kind === 'new' || selected.decision) return undefined
      const i = impactOf(register, c, { scanned, usage })
      // Contrast only where it helps decide: when one side falls below 4.5:1 (text, WCAG AA).
      const weak = i.contrast && Math.min(i.contrast.before, i.contrast.after) < MIN_CONTRAST
      return {
        aliases: i.aliases,
        uses: i.uses,
        contrast:
          i.contrast && weak
            ? { token: i.contrast.token, before: ratio(i.contrast.before), after: ratio(i.contrast.after) }
            : undefined,
      }
    }
    const impacts = selected.changes.flatMap((c) => {
      const impact = impactFor(c)
      return impact ? [{ token: c.token, impact }] : []
    })
    // One changed token: its aliases move with it, and the adopt consequence says so.
    const onlyChange = selected.changes.length === 1 ? selected.changes[0] : undefined
    const onlyImpact = onlyChange && impacts.find((i) => i.token === onlyChange.token)?.impact
    const copy = decisionCopyOf(selected, onlyImpact?.aliases ?? [])
    const OPTIONS: Option[] = ['adopt', 'reset', 'reject']
    // Handoffs adopt only named colours (from "Name them yourself") and have no Ignore: it would end
    // like "Adopt nothing".
    const offered = OPTIONS.filter((o) =>
      selected.kind === 'handoff' ? o === 'reset' : !(o === 'adopt' && blocked),
    )
    const labels = Object.fromEntries(
      OPTIONS.map((o) => [o, t(copy.label[o].key, copy.label[o].values)]),
    ) as Record<Option, string>
    const effects = Object.fromEntries(
      OPTIONS.map((o) => [o, <Rich key={o} message={copy.effect[o]} t={t} />]),
    ) as Record<Option, ReactNode>
    // A single colour change: the kept and the adopted colour as small swatches on their buttons.
    const only = selected.changes.length === 1 ? selected.changes[0] : undefined
    const colorChange = only?.kind === 'change' && only.type === 'color'
    const swatches = colorChange ? { reset: only.before, adopt: only.after } : undefined
    // A colour that is no register colour: show the register's closest token next to the pair.
    const mustNearest = selected.rules.find((r) => r.level === 'must' && r.nearest)?.nearest
    const nearestValue = mustNearest ? tokenValueOf(mustNearest) : undefined
    const nearest = mustNearest && nearestValue ? { token: mustNearest, value: nearestValue } : undefined
    // Who decides and why: the sentence moves into the details while the decision is open (the
    // footer says what to do and why); a decided item shows its note; a code task has nothing else.
    const whyTitle = selected.kind === 'code' ? t('whyCode') : t('whyTitle')
    const why =
      selected.why.key === 'why.safe' ? undefined : (
        <section className={styles.why} aria-labelledby="why-title">
          <h3 id="why-title" className={styles.whyTitle}>
            {whyTitle}
          </h3>
          <p className={styles.whyText}>
            <Rich message={selected.why} t={t} />
          </p>
        </section>
      )

    const details = (
      <details className={styles.details}>
        <DisclosureSummary>{t('details')}</DisclosureSummary>
        <div className={styles.detailsBody}>
          {openDecision && why}
          {rules.length > 0 && (
            <ul className={styles.rules}>
              {rules.slice(0, 3).map((r) => (
                <RuleCard key={r.decision} rule={r} t={t} />
              ))}
            </ul>
          )}
          {impacts.map(({ token, impact }) => (
            <div key={token} className={styles.detailsItem}>
              {impacts.length > 1 && <code className={styles.token}>{token}</code>}
              <Impact impact={impact} t={t} />
            </div>
          ))}
          {selected.kind === 'handoff' && (
            <>
              <DraftColors title={t('colors.near')} colors={nearColors} limit={10} num={num} t={t} />
              <DraftColors title={t('colors.new')} colors={newColors} limit={5} grid num={num} t={t} />
              <DraftColors
                title={t('colors.exact')}
                colors={selected.colors.filter((c) => c.match === 'exact')}
                limit={3}
                num={num}
                t={t}
              />
            </>
          )}
          {selected.kind === 'code' && selected.code && (
            <>
              <PropertyList
                rows={[
                  { label: t('code.file'), value: <code>{selected.code.file}</code> },
                  { label: t('code.count'), value: selected.code.count },
                  {
                    label: t('code.tokens'),
                    value:
                      selected.code.replacements.length > 0 ? (
                        <code>{selected.code.replacements.slice(0, 4).join(', ')}</code>
                      ) : (
                        t('code.noTokens')
                      ),
                  },
                ]}
              />
              <div className={styles.commandBlock}>
                <span className={styles.fine}>{t('code.command')}</span>
                <span className={styles.command}>
                  <code>{`accord check ${selected.code.file}`}</code>
                  <CopyButton value={`accord check ${selected.code.file}`} />
                </span>
              </div>
            </>
          )}
          {openDecision && (
            <div className={styles.detailsItem}>
              <h3 className={styles.detailsTitle}>{t('effect.title')}</h3>
              <ul className={styles.effects}>
                {offered.map((o) => (
                  <li key={o}>
                    {/* The button's "…" (asks once more) is no part of the name here. */}
                    <strong>{labels[o].replace(/\s*…$/, '')}:</strong> {effects[o]}
                  </li>
                ))}
              </ul>
              {preview?.ok && (
                <ul
                  className={styles.fileList}
                  aria-label={t('effect.files', { count: preview.files.length })}
                >
                  {preview.files.map((f) => (
                    <li key={f.path} className={styles.fileItem}>
                      <code>{f.path}</code>
                      <span className={styles.muted}>{t(`fileKind.${f.kind}`)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {blocked && <Notice tone="warning">{t('effect.blocked', { detail: blocked })}</Notice>}
              {preview && !preview.ok && !blocked && (
                <Notice tone="warning">{t(`error.${preview.code}`, { detail: preview.detail ?? '' })}</Notice>
              )}
              <p className={styles.fine}>{t('effect.local')}</p>
            </div>
          )}
          {selected.decidable && (
            <p className={`${styles.fine} ${styles.idLine}`}>
              <code>{selected.id}</code>
            </p>
          )}
        </div>
      </details>
    )

    const body = (
      <>
        {selected.decision && (
          <div className={styles.decidedBox}>
            <Notice tone={selected.decision.option === 'adopt' ? 'success' : 'neutral'} role="status">
              {t(
                selected.kind === 'handoff' && selected.decision.option === 'reset'
                  ? 'decided.resetHandoff'
                  : `decided.${selected.decision.option}`,
                {
                  by: selected.decision.by || t('decided.unknown'),
                  at: selected.decision.at
                    ? format.dateTime(new Date(selected.decision.at), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })
                    : t('decided.unknownTime'),
                },
              )}
            </Notice>
            {undo && <UndoDecision project={project.slug} id={selected.id} />}
          </div>
        )}

        {selected.kind === 'surface' && (
          <ul className={styles.changes} aria-label={t('change.title')}>
            {selected.changes.map((c) => (
              <ChangePreview
                key={`${c.kind}-${c.token}`}
                change={c}
                tool={selected.tool}
                adopted={adopted}
                showToken={selected.changes.length > 1}
                nearest={openDecision ? nearest : undefined}
                t={t}
              />
            ))}
          </ul>
        )}

        {selected.kind === 'handoff' && (
          <HandoffGlance
            fresh={newColors}
            near={nearColors}
            num={num}
            t={t}
            more={(count, label) => (openDecision ? <OpenNames count={count} label={label} /> : undefined)}
          />
        )}

        {selected.decision?.note && (
          <section className={styles.why} aria-labelledby="why-title">
            <h3 id="why-title" className={styles.whyTitle}>
              {t('whyDecided')}
            </h3>
            <p className={styles.whyText}>{t('decided.because', { note: selected.decision.note })}</p>
          </section>
        )}
        {!openDecision && !selected.decision && why}

        {/* The quiet extras, one line each until opened: naming, details. */}
        <div className={styles.disclosures}>
          {openDecision && selected.kind === 'handoff' && (
            <HandoffNames
              colors={newColors
                .slice(0, NAMEABLE)
                .map((c) => ({ value: c.value, count: c.count, label: colorLabel(c.value, num, t) }))}
              more={Math.max(0, newColors.length - NAMEABLE)}
              command="accord apply --resolution resolution.json"
            />
          )}
          {details}
        </div>
      </>
    )

    const meta = (
      <span className={styles.metaLine}>
        <ToolTile tool={selected.tool} size="sm" />
        <span>{t(`tool.${selected.tool}`)}</span>
        {when && (
          <>
            <span aria-hidden="true">·</span>
            <time dateTime={when.iso}>{when.text}</time>
          </>
        )}
      </span>
    )

    const panel = (
      <Inspector
        label={tp('detail')}
        meta={meta}
        title={t(selected.title.key, selected.title.values)}
        heading={<Rich message={selected.title} t={t} />}
        backHref={base}
        backLabel={tp('back')}
        footer={
          openDecision && recommendation ? (
            <DecisionButtons />
          ) : selected.kind === 'code' && selected.code ? (
            <CopyButton
              value={t('code.task', {
                file: selected.code.file,
                count: selected.code.count,
                tokens: selected.code.replacements.slice(0, 4).join(', ') || 'none',
              })}
              text={t('code.copyTask')}
              label={t('code.copyTask')}
              variant="primary"
            />
          ) : undefined
        }
      >
        {body}
      </Inspector>
    )

    inspector =
      openDecision && recommendation ? (
        <DecisionProvider
          key={selected.id}
          project={project.slug}
          id={selected.id}
          kind={selected.kind === 'handoff' ? 'handoff' : 'surface'}
          tool={selectArg(selected.tool)}
          deletes={removed}
          breaking={selected.risk.breaking}
          adoptBlocked={blocked}
          defaultBy={by}
          nextHref={next ? href(next.id) : base}
          selfHref={href(selected.id)}
          recommend={recommendation.option}
          recommendText={<Rich message={recommendation.reason} t={t} />}
          labels={labels}
          effects={effects}
          swatches={swatches}
          uses={removedUses}
        >
          {panel}
        </DecisionProvider>
      ) : (
        panel
      )
  }

  // --- List -------------------------------------------------------------------------------------
  // A row: the source as an icon, what changed (title and a visual preview), and one chip at most.
  const row = (p: ProposalView) => {
    const current = p.id === selected?.id
    const chip = rowChip(p, t)
    return (
      <li key={p.id}>
        <Link
          className={styles.row}
          href={href(p.id)}
          aria-current={current && wanted ? 'true' : undefined}
          data-preselected={current && !wanted ? '' : undefined}
          data-proposal={p.id}
          scroll={false}
        >
          <ToolTile tool={p.tool} />
          <span className={styles.rowText}>
            <span className={styles.rowTitle}>
              <Rich message={p.title} t={t} />
            </span>
            <span className={styles.rowSummary}>
              <RowPreview proposal={p} />
              <span className={styles.rowSummaryText}>
                <SummaryText summary={p.summary} t={t} />
              </span>
            </span>
            <span className="visually-hidden">{t('source', { tool: t(`tool.${p.tool}`) })}</span>
          </span>
          {chip && <span className={styles.rowMeta}>{chip}</span>}
        </Link>
      </li>
    )
  }

  // Safe to adopt in one go: from the owner, no rule broken, nothing deleted or broken.
  const safeIds = proposals
    .filter((p) => p.group === 'auto' && p.route === 'auto' && p.kind === 'surface' && p.decidable)
    .filter((p) => !p.risk.deletion && !p.risk.breaking && !p.risk.conflict)
    .map((p) => p.id)

  const group = (g: InboxGroup) => {
    const items = proposals.filter((p) => p.group === g)
    if (items.length === 0) return null
    // At inbox zero the sentence already names the files in code; their group only shows when one of
    // them was opened (a link from the overview).
    if (g === 'code' && open.length === 0 && selected?.group !== 'code') return null
    if (FOLDED.includes(g))
      return (
        <details key={g} className={styles.group} open={selected?.group === g || undefined}>
          <summary className={`${styles.groupHead} ${styles.groupToggle}`}>
            <ChevronRight aria-hidden="true" className={styles.chevron} />
            <span className={styles.groupName}>{tp(`group.${g}`)}</span>
            <span className={styles.groupCount} aria-hidden="true">
              {items.length}
            </span>
            <span className="visually-hidden">
              {/* The code group holds files, not decisions. */}
              {tp(g === 'code' ? 'groupCountFiles' : 'groupCount', { count: items.length })}
            </span>
          </summary>
          <p className={styles.groupHint}>{tp(`groupHint.${g}`)}</p>
          <ul className={styles.rows} aria-label={tp(`group.${g}`)} aria-keyshortcuts="J K">
            {items.map(row)}
          </ul>
        </details>
      )
    return (
      <section key={g} className={styles.group} aria-labelledby={`group-${g}`}>
        <div className={styles.groupBar}>
          <h2 id={`group-${g}`} className={styles.groupHead}>
            <span className={styles.groupName}>{tp(`group.${g}`)}</span>
          </h2>
          {g === 'auto' && safeIds.length > 1 && by && (
            <BulkAdopt project={project.slug} ids={safeIds} by={by} />
          )}
        </div>
        {g === 'auto' && <p className={styles.groupHint}>{tp(`groupHint.${g}`)}</p>}
        <ul className={styles.rows} aria-keyshortcuts="J K">
          {items.map(row)}
        </ul>
      </section>
    )
  }

  return (
    <Shell
      project={project}
      active="decisions"
      item={wanted && selected ? t(selected.title.key, selected.title.values) : undefined}
      flush
    >
      <PanelLayout open={Boolean(wanted && selected)} inspector={inspector} wide heading={tp('heading')}>
        <PageHeader compact title={tp('heading')} />

        {/* The filter is a state of the list, not a control of its own: it says what is shown and goes. */}
        {source && (
          <div className={styles.filterBar}>
            <Link href={projectHref(project.slug, 'decisions')} className={ui.activeFilter} scroll={false}>
              {tp('filter.only', { tool: tp(`tool.${source}`) })}
              <X aria-hidden="true" />
              <span className="visually-hidden">{tp('filter.clear')}</span>
            </Link>
          </div>
        )}

        {unreadable.length > 0 && (
          <Notice tone="warning" icon={<Info aria-hidden="true" />}>
            {tp('unreadable', { count: unreadable.length, files: unreadable.join(', ') })}
          </Notice>
        )}

        {open.length === 0 &&
          (source ? (
            // Filtered to one surface: nothing open from it. Code has its files below instead.
            source !== 'code' || codeTasks.length === 0 ? (
              <EmptyState
                title={tp('filter.emptyTitle', { tool: tp(`tool.${source}`) })}
                text={tp('filter.emptyText', { tool: tp(`tool.${source}`) })}
                action={
                  <ButtonLink
                    href={projectHref(project.slug, 'decisions')}
                    variant="quiet"
                    className={styles.zeroAction}
                  >
                    {tp('filter.all')}
                  </ButtonLink>
                }
              />
            ) : null
          ) : proposals.length === 0 && !surfacesFound ? (
            <EmptyState
              title={tp('inboxZero.noSurfaceTitle')}
              text={tp('inboxZero.noSurface')}
              action={
                <ButtonLink href={projectHref(project.slug, 'connections')} variant="primary">
                  {tp('inboxZero.connect')}
                </ButtonLink>
              }
            />
          ) : (
            <EmptyState
              title={tp('inboxZero.title')}
              text={
                codeTasks.length > 0
                  ? `${counts.decided > 0 ? tp('inboxZero.text', { tools: toolList }) : tp('inboxZero.none')} ${tp('inboxZero.code', { count: codeTasks.length })}`
                  : counts.decided > 0
                    ? tp('inboxZero.text', { tools: toolList })
                    : tp('inboxZero.none')
              }
              // A finished state: one quiet way on, no primary for work someone else does. The file in
              // code waits on the overview's list.
              action={
                <ButtonLink href={projectHref(project.slug)} variant="quiet" className={styles.zeroAction}>
                  {tp('inboxZero.overview')}
                </ButtonLink>
              }
            />
          ))}

        <div className={styles.groups}>{GROUPS.map(group)}</div>
        {open.length > 0 && <ShortcutSheet />}
        <InboxKeys ids={proposals.map((p) => p.id)} selected={selected?.id} base={base} />
      </PanelLayout>
    </Shell>
  )
}
