import { type ColorValue, cssToColor } from '@decivo/accord-core'
import type { CSSProperties, ReactNode } from 'react'
import type { ChangeView, DraftColorView, Message, ProposalView, RuleView, Tool } from '@/lib/proposals'
import { ArrowRight, ChevronRight, CircleX, Plus, ToolIcon } from './icons'
import styles from './proposals.module.css'
import { Swatch } from './swatch'

/** `t` of the `proposals` namespace (server or client). */
export type T = (key: string, values?: Record<string, string | number>) => string

/** Locale-aware number formatting (next-intl's `format.number`). */
export type Num = (value: number, options?: Intl.NumberFormatOptions) => string

/** What else moves when a token changes: aliases that follow, uses in code, contrast. */
export interface ChangeImpact {
  /** Tokens that reference this one (directly or through other aliases). */
  aliases: string[]
  /** References in the scanned code (token and its aliases); undefined when no code was scanned. */
  uses?: number | undefined
  /** Colours: contrast against a surface or text token, before and after. */
  contrast?: { token: string; before: string; after: string } | undefined
}

export const toolKey = (tool: Tool) => (tool === 'claude-design' ? 'claude_design' : tool)

/** Values that are names or measurements: set in mono inside a sentence or a heading, never in the serif. */
const MONO = [
  'token',
  'tokens',
  'aliases',
  'before',
  'after',
  'value',
  'nearest',
  'nearestValue',
  'tokenValue',
  'file',
  'at',
]
const MARK = /\uE000(\d+)\uE001/

/**
 * A message whose token names, values and paths render as `<code>` (IBM Plex Mono) inside the text,
 * so `spacing.4` or `#3c6681` look the same in a heading, a sentence and the register.
 */
export function Rich({ message, t, mono = MONO }: { message: Message; t: T; mono?: string[] | undefined }) {
  const values = { ...(message.values ?? {}) }
  const marked: string[] = []
  for (const key of mono) {
    const value = values[key]
    if (typeof value !== 'string' || value === '' || value === 'none') continue
    values[key] = `\uE000${marked.length}\uE001`
    marked.push(value)
  }
  if (marked.length === 0) return <>{t(message.key, message.values)}</>
  const parts = t(message.key, values).split(MARK)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one sentence never reorder
          <code key={i} className={styles.inlineCode}>
            {marked[Number(part)]}
          </code>
        ) : (
          part
        ),
      )}
    </>
  )
}

/**
 * The summary of a disclosure in the inspector ("Details", "Selbst benennen"): a chevron that turns
 * when it opens, like every other disclosure in the app, so it reads as a control and not a heading.
 */
export function DisclosureSummary({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <summary className={className ? `${styles.disclosure} ${className}` : styles.disclosure}>
      <ChevronRight aria-hidden="true" className={styles.disclosureChevron} />
      {children}
    </summary>
  )
}

/** The tool's mark as a bare icon in the muted ink (no tile: a list row is not a card). */
export function ToolTile({ tool, size = 'md' }: { tool: Tool; size?: 'sm' | 'md' }) {
  return (
    <span className={`${styles.toolTile} ${size === 'sm' ? styles.toolTileSm : ''}`} aria-hidden="true">
      <ToolIcon tool={toolKey(tool)} />
    </span>
  )
}

type Look = 'color' | 'radius' | 'length' | 'fontSize' | 'fontFamily' | 'fontWeight' | 'text'

/** How to preview a value: colours as swatches, radii as rounded boxes, lengths as bars, fonts as samples. */
export function lookOf(change: Pick<ChangeView, 'type' | 'token' | 'before' | 'after'>): Look {
  const path = change.token.toLowerCase()
  if (change.type === 'color') return 'color'
  if (change.type === 'fontFamily') return 'fontFamily'
  if (change.type === 'fontWeight') return 'fontWeight'
  if (change.type === 'dimension') {
    if (/radius|rounded|corner/.test(path)) return 'radius'
    if (/(^|\.)(font|text|type)/.test(path) && /size/.test(path)) return 'fontSize'
    return 'length'
  }
  const value = change.after ?? change.before
  if (change.type === 'unknown' && value && cssToColor(value)) return 'color'
  return 'text'
}

function Visual({ look, value, t }: { look: Look; value: string; t: T }) {
  switch (look) {
    case 'color':
      return <Swatch color={value} size="lg" />
    case 'radius':
      // A whole square at its real size: 12px and 16px side by side read as different shapes.
      return (
        <span className={styles.stage}>
          <span className={styles.radiusBox} style={{ '--preview-radius': value } as CSSProperties} />
        </span>
      )
    case 'length':
      // Figma's spacing redline: the gap between two hairline blocks, centred, drawn three times
      // larger when it is small (like the radius corner), with end ticks.
      return <Gap value={value} />
    case 'fontSize':
      return (
        <span className={styles.stage}>
          <span className={styles.sample} style={{ '--preview-size': value } as CSSProperties}>
            Aa
          </span>
        </span>
      )
    case 'fontFamily':
      return (
        <span className={styles.stage}>
          <span className={styles.sample} style={{ '--preview-font': value } as CSSProperties}>
            {t('change.sample')}
          </span>
        </span>
      )
    case 'fontWeight':
      return (
        <span className={styles.stage}>
          <span className={styles.sample} style={{ '--preview-weight': value } as CSSProperties}>
            {t('change.sample')}
          </span>
        </span>
      )
    default:
      return null
  }
}

/** A spacing as a gap between two blocks, zoomed 3x up to 24px so 4px and 8px read differently. */
function Gap({ value, ghost = false }: { value: string; ghost?: boolean }) {
  const px = pxOf(value)
  const zoom = px !== undefined && px <= 24 ? 3 : 1
  return (
    <span className={`${styles.stage} ${ghost ? styles.stageGhost : ''}`}>
      <span className={styles.gapBlock} />
      <span
        className={styles.gap}
        style={{ '--preview-length': px !== undefined ? `${px * zoom}px` : value } as CSSProperties}
      />
      <span className={styles.gapBlock} />
    </span>
  )
}

function Side({
  label,
  value,
  look,
  empty,
  ghost,
  t,
}: {
  label: string
  value?: string | undefined
  look: Look
  /** No value on this side: not in the register yet, or deleted. */
  empty?: { icon: ReactNode; text: string } | undefined
  /** A deleted spacing: the same gap as a dashed ghost, so the two sides compare. */
  ghost?: string | undefined
  t: T
}) {
  return (
    <div className={styles.side}>
      <span className={styles.sideLabel}>{label}</span>
      {ghost !== undefined && look === 'length' ? (
        <>
          <Gap value={ghost} ghost />
          <span className={styles.ghostLabel}>
            {empty?.icon}
            {empty?.text}
          </span>
        </>
      ) : empty || value === undefined ? (
        <span className={styles.emptySide}>
          {empty?.icon}
          {empty?.text && <span>{empty.text}</span>}
        </span>
      ) : (
        <>
          <Visual look={look} value={value} t={t} />
          <code className={styles.value}>{value}</code>
        </>
      )}
    </div>
  )
}

/** A length in px (`16px`, `1rem`), for drawing two values on one scale; undefined when it is not one. */
export function pxOf(value: string | undefined): number | undefined {
  const m = value?.trim().match(/^(-?\d*\.?\d+)(px|rem|em)?$/)
  if (!m) return undefined
  const n = Number(m[1])
  return m[2] === 'rem' || m[2] === 'em' ? n * 16 : n
}

/**
 * Radius and spacing changes as one picture, so a 4px difference is visible: two corners drawn on top
 * of each other (the register's dashed, the new one solid), or two bars on a shared scale.
 */
function Overlay({
  look,
  before,
  after,
  tool,
  t,
}: {
  look: 'radius' | 'length'
  before: string
  after: string
  tool: Tool
  t: T
}) {
  const a = pxOf(before) ?? 0
  const b = pxOf(after) ?? 0
  const max = Math.max(a, b, 1)
  const legend = (
    <ul className={styles.legend}>
      <li>
        <span className={`${styles.key} ${styles.keyBefore}`} aria-hidden="true" />
        <span className={styles.sideLabel}>{t('change.before')}</span>
        <code className={styles.value}>{before}</code>
      </li>
      <li>
        <span className={`${styles.key} ${styles.keyAfter}`} aria-hidden="true" />
        <span className={styles.sideLabel}>{t('change.after', { tool })}</span>
        <code className={styles.value}>{after}</code>
      </li>
    </ul>
  )
  if (look === 'radius')
    return (
      <div className={styles.overlay}>
        <span className={styles.cornerStage} role="img" aria-label={t('change.scale', { before, after })}>
          <span
            className={`${styles.corner} ${styles.cornerBefore}`}
            style={{ '--preview-radius': before } as CSSProperties}
          />
          <span
            className={`${styles.corner} ${styles.cornerAfter}`}
            style={{ '--preview-radius': after } as CSSProperties}
          />
        </span>
        <div className={styles.legendBox}>
          {legend}
          <span className={styles.fine}>{t('change.zoom')}</span>
        </div>
      </div>
    )
  return (
    <div className={styles.bars} role="img" aria-label={t('change.scale', { before, after })}>
      {[
        { label: t('change.before'), value: before, px: a, cls: styles.barBefore },
        { label: t('change.after', { tool }), value: after, px: b, cls: styles.barAfter },
      ].map((row) => (
        <div key={row.label} className={styles.barRow}>
          <span className={styles.sideLabel}>{row.label}</span>
          <span className={styles.barTrack}>
            <span
              className={`${styles.bar} ${row.cls}`}
              style={{ '--bar': `${(row.px / max) * 100}%` } as CSSProperties}
            />
            <code className={styles.value}>{row.value}</code>
          </span>
        </div>
      ))}
    </div>
  )
}

/** One change as before → after, the way Figma's variables panel would show it. */
export function ChangePreview({
  change,
  tool,
  impact,
  adopted = false,
  showToken = false,
  nearest,
  t,
}: {
  change: ChangeView
  tool: Tool
  impact?: ChangeImpact | undefined
  /** Decided and adopted: the pair reads "before" and "now in the register". */
  adopted?: boolean | undefined
  /** Several changes in one proposal: name each token (one change is named by the title). */
  showToken?: boolean | undefined
  /** A colour that is no register colour: the closest register token, as a third swatch. */
  nearest?: { token: string; value: string } | undefined
  t: T
}) {
  const look = lookOf(change)
  const overlay =
    !adopted &&
    change.kind === 'change' &&
    (look === 'radius' || look === 'length') &&
    pxOf(change.before) !== undefined &&
    pxOf(change.after) !== undefined
  return (
    <li className={styles.change}>
      {showToken && (
        <div className={styles.changeHead}>
          <code className={styles.token}>{change.token}</code>
        </div>
      )}
      {overlay && change.before && change.after && (look === 'radius' || look === 'length') ? (
        <Overlay look={look} before={change.before} after={change.after} tool={tool} t={t} />
      ) : (
        <div className={styles.compare}>
          <Side
            label={adopted ? t('change.was') : t('change.before')}
            value={change.before}
            look={look}
            t={t}
            empty={
              change.kind === 'new'
                ? { icon: <Plus aria-hidden="true" />, text: t('change.notInRegister') }
                : undefined
            }
          />
          <span className={styles.arrow} aria-hidden="true">
            <ArrowRight />
          </span>
          <Side
            label={adopted ? t('change.now') : t('change.after', { tool })}
            value={change.after}
            look={look}
            t={t}
            ghost={change.kind === 'remove' ? change.before : undefined}
            empty={
              change.kind === 'remove'
                ? { icon: <CircleX aria-hidden="true" />, text: t('change.deleted') }
                : undefined
            }
          />
        </div>
      )}
      {nearest && look === 'color' && (
        <div className={styles.nearest}>
          <Swatch color={nearest.value} />
          <span className={styles.colorText}>
            <span className={styles.sideLabel}>{t('change.nearest')}</span>
            <span>
              <code className={styles.colorToken}>{nearest.token}</code>{' '}
              <code className={styles.muted}>{nearest.value}</code>
            </span>
          </span>
        </div>
      )}
      {impact && <Impact impact={impact} t={t} />}
      {change.variable && (
        <p className={styles.fine}>{t('change.variable', { tool, name: change.variable })}</p>
      )}
      {change.origin !== 'surface' && (
        <p className={styles.fine}>
          {t(change.origin === 'conflict' ? 'change.conflict' : 'change.unknownOrigin')}
        </p>
      )}
    </li>
  )
}

/** The blast radius a designer checks first: aliases that change too, uses in code, contrast. */
export function Impact({ impact, t }: { impact: ChangeImpact; t: T }) {
  return (
    <div className={styles.impact}>
      <span className={styles.impactTitle}>{t('impact.title')}</span>
      <ul className={styles.impactList}>
        {impact.aliases.length > 0 && (
          <li className={styles.impactItem}>
            <span className={styles.muted}>{t('impact.aliases', { count: impact.aliases.length })}</span>
            {impact.aliases.slice(0, 4).map((a) => (
              <code key={a} className={styles.aliasChip}>
                {a}
              </code>
            ))}
            {impact.aliases.length > 4 && <span className={styles.muted}>+{impact.aliases.length - 4}</span>}
          </li>
        )}
        <li className={styles.impactItem}>
          {impact.uses === undefined ? t('impact.notScanned') : t('impact.uses', { uses: impact.uses })}
        </li>
        {impact.contrast && (
          <li className={styles.impactItem}>
            <span>
              <Rich
                message={{
                  key: 'impact.contrast',
                  values: {
                    token: impact.contrast.token,
                    before: impact.contrast.before,
                    after: impact.contrast.after,
                  },
                }}
                t={t}
              />
            </span>
          </li>
        )}
      </ul>
    </div>
  )
}

/** "a → b" with the one arrow icon of the interface (never the → glyph), read as "a to b". */
export function Pair({ before, after, t }: { before: string; after: string; t: T }) {
  return (
    <span className={styles.pair}>
      <code>{before}</code>
      <ArrowRight className={styles.rowArrow} aria-hidden="true" />
      <span className="visually-hidden">{t('summary.to')}</span>
      <code>{after}</code>
    </span>
  )
}

/** A row's one-line summary; value changes as a pair with the arrow icon. */
export function SummaryText({ summary, t }: { summary: Message; t: T }) {
  if (summary.key === 'summary.change' && summary.values)
    return <Pair before={String(summary.values.before)} after={String(summary.values.after)} t={t} />
  return <Rich message={summary} t={t} />
}

/** Small before → after swatches for a list row (single colour changes), or a handoff's top colours. */
export function RowPreview({ proposal }: { proposal: Pick<ProposalView, 'kind' | 'changes' | 'colors'> }) {
  if (proposal.kind === 'handoff') {
    // The same framed squares as a single colour change (never round dots: those are the logo's).
    // The five most used; the sentence beside them carries the counts (no competing "+200").
    const top = proposal.colors
      .filter((c) => c.match !== 'exact')
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
    if (top.length === 0) return null
    return (
      <span className={styles.rowSwatches} aria-hidden="true">
        {top.map((c) => (
          <Swatch key={c.value} color={c.value} size="sm" />
        ))}
      </span>
    )
  }
  const [only] = proposal.changes
  if (proposal.changes.length !== 1 || !only || lookOf(only) !== 'color') return null
  return (
    <span className={styles.rowSwatches} aria-hidden="true">
      {only.before && <Swatch color={only.before} size="sm" />}
      {only.before && only.after && <ArrowRight className={styles.rowArrow} />}
      {only.after && <Swatch color={only.after} size="sm" />}
    </span>
  )
}

type Hue = 'gray' | 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'pink'
const HUES: Hue[] = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink']

/** Hue family of a colour, to group a long list of new colours the way a colour picker would. */
export function hueOf(color: ColorValue | undefined): Hue {
  const [r = 0, g = 0, b = 0] = (color?.components ?? []).map((c) => (typeof c === 'number' ? c : 0))
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const chroma = max - min
  if (chroma < 0.08) return 'gray'
  let h: number
  if (max === r) h = ((g - b) / chroma) % 6
  else if (max === g) h = (b - r) / chroma + 2
  else h = (r - g) / chroma + 4
  const deg = (h * 60 + 360) % 360
  if (deg < 15 || deg >= 345) return 'red'
  if (deg < 45) return 'orange'
  if (deg < 70) return 'yellow'
  if (deg < 165) return 'green'
  if (deg < 195) return 'teal'
  if (deg < 255) return 'blue'
  if (deg < 290) return 'purple'
  return 'pink'
}

/** A colour as Figma writes it: `#000000 · 8 %` for transparent ones, else the value as it is. */
export function colorLabel(value: string, num: Num, t: T): string {
  const color = cssToColor(value)
  if (!color || color.alpha === undefined || color.alpha >= 1) return value
  return t('colors.alpha', { hex: color.hex ?? value, alpha: num(color.alpha, { style: 'percent' }) })
}

/** CIEDE2000 distance below which two colours look the same to most people. */
const BARELY_VISIBLE = 2.3

function DraftRow({ c, num, t }: { c: DraftColorView; num: Num; t: T }) {
  return (
    <li className={styles.colorRow}>
      <Swatch color={c.value} />
      <span className={styles.colorText}>
        <code>{colorLabel(c.value, num, t)}</code>
        <span className={styles.muted}>{t('colors.count', { count: c.count })}</span>
      </span>
      {c.token && (
        <>
          <ArrowRight className={styles.rowArrow} aria-hidden="true" />
          {c.tokenValue ? <Swatch color={c.tokenValue} /> : <span />}
          <span className={styles.colorText}>
            <code className={styles.colorToken}>{c.token}</code>
            <span className={styles.colorMeta}>
              {c.tokenValue && <code className={styles.muted}>{colorLabel(c.tokenValue, num, t)}</code>}
              {c.distance !== undefined && (
                <span
                  className={styles.distance}
                  title={t('colors.distanceLabel', {
                    value: num(c.distance, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                  })}
                >
                  {t('colors.distance', { level: c.distance < BARELY_VISIBLE ? 'low' : 'high' })}
                </span>
              )}
            </span>
          </span>
        </>
      )}
    </li>
  )
}

/** The rest of a long list of new colours: small chips grouped by hue, the hex in the tooltip. */
function ChipGrid({ colors, num, t }: { colors: DraftColorView[]; num: Num; t: T }) {
  const groups = new Map<Hue, DraftColorView[]>()
  for (const c of colors) {
    const hue = hueOf(cssToColor(c.value))
    groups.set(hue, [...(groups.get(hue) ?? []), c])
  }
  return (
    <div className={styles.hueGroups}>
      {HUES.filter((h) => groups.has(h)).map((hue) => {
        const list = groups.get(hue) ?? []
        return (
          <div key={hue} className={styles.hueGroup}>
            <span className={styles.hueName}>
              {t('colors.hue', { hue })} <span className={styles.groupCount}>{list.length}</span>
            </span>
            <ul className={styles.chips}>
              {list.map((c) => {
                const label = t('colors.chip', { value: colorLabel(c.value, num, t), count: c.count })
                return (
                  <li key={c.value} className={styles.chip} title={label}>
                    <Swatch color={c.value} size="xs" />
                    <span className="visually-hidden">{label}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

/** A handoff's colours: the draft value next to the register token it is (close to). */
export function DraftColors({
  title,
  colors,
  limit,
  grid = false,
  num,
  t,
}: {
  title: string
  colors: DraftColorView[]
  limit: number
  /** Show the rest as a chip grid grouped by hue (long lists of new colours). */
  grid?: boolean | undefined
  num: Num
  t: T
}) {
  if (colors.length === 0) return null
  const rest = colors.slice(limit)
  return (
    <div className={styles.colorGroup}>
      <h3 className={styles.colorGroupTitle}>
        {title} <span className={styles.muted}>({colors.length})</span>
      </h3>
      <ul className={styles.colorList}>
        {colors.slice(0, limit).map((c) => (
          <DraftRow key={c.value} c={c} num={num} t={t} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details className={styles.more}>
          <DisclosureSummary>{t('colors.more', { count: rest.length })}</DisclosureSummary>
          {grid ? (
            <ChipGrid colors={rest} num={num} t={t} />
          ) : (
            <ul className={styles.colorList}>
              {rest.map((c) => (
                <DraftRow key={c.value} c={c} num={num} t={t} />
              ))}
            </ul>
          )}
        </details>
      )}
    </div>
  )
}

/** How many new colours the strip shows (one row at phone width); the rest is one "+N" at its end. */
const STRIP = 12

/**
 * Colours the way a colour picker orders them: by hue family, then light to dark; transparencies
 * (overlays) last, so 195 colours read as greys, blues and alphas at a glance.
 */
export function byHue(colors: DraftColorView[]): DraftColorView[] {
  const key = (c: DraftColorView) => {
    const color = cssToColor(c.value)
    const alpha = color?.alpha !== undefined && color.alpha < 1
    const [r = 0, g = 0, b = 0] = (color?.components ?? []).map((x) => (typeof x === 'number' ? x : 0))
    const light = (Math.max(r, g, b) + Math.min(r, g, b)) / 2
    return { alpha: alpha ? 1 : 0, hue: HUES.indexOf(hueOf(color)), light }
  }
  return colors
    .map((c) => ({ c, k: key(c) }))
    .sort((a, b) => a.k.alpha - b.k.alpha || a.k.hue - b.k.hue || b.k.light - a.k.light)
    .map(({ c }) => c)
}

/**
 * The first look at a handoff: its most used new colours as one strip, ordered by hue (at most 12, the rest as
 * "+N" that opens "Name them yourself"), and up to three close matches as pairs (draft colour, the
 * token it matches). Each swatch names its value and uses on hover. Distances wait in the details.
 */
export function HandoffGlance({
  fresh,
  near,
  num,
  t,
  more,
}: {
  fresh: DraftColorView[]
  near: DraftColorView[]
  num: Num
  t: T
  /** The "+N" at the end of the strip, e.g. a button that opens "Name them yourself". */
  more?: ((count: number, label: string) => ReactNode) | undefined
}) {
  // The most used ones, then in picker order, so the strip shows the draft's range, not 12 greys.
  const shown = byHue([...fresh].sort((a, b) => b.count - a.count).slice(0, STRIP))
  const rest = fresh.length - shown.length
  const restLabel = t('colors.moreNewLabel', { count: rest })
  return (
    <>
      {fresh.length > 0 && (
        <div className={styles.colorGroup}>
          <h3 className={styles.colorGroupTitle}>
            {t('colors.new')} <span className={styles.muted}>({fresh.length})</span>
          </h3>
          <ul className={styles.strip} aria-label={t('colors.newStrip')}>
            {shown.map((c) => {
              const label = t('colors.chip', { value: colorLabel(c.value, num, t), count: c.count })
              return (
                <li key={c.value} title={label}>
                  <Swatch color={c.value} size="sm" />
                  <span className="visually-hidden">{label}</span>
                </li>
              )
            })}
            {rest > 0 && (
              <li className={styles.stripMore}>
                {more?.(rest, restLabel) ?? (
                  <span className={styles.muted} title={restLabel}>
                    {t('colors.moreNew', { count: rest })}
                    <span className="visually-hidden"> {restLabel}</span>
                  </span>
                )}
              </li>
            )}
          </ul>
        </div>
      )}
      {near.length > 0 && (
        <div className={styles.colorGroup}>
          <h3 className={styles.colorGroupTitle}>
            {t('colors.near')} <span className={styles.muted}>({near.length})</span>
          </h3>
          <ul className={styles.pairs}>
            {near.slice(0, 3).map((c) => (
              <li key={c.value} className={styles.pairRow}>
                <Swatch color={c.value} size="sm" />
                <code className={styles.muted}>{colorLabel(c.value, num, t)}</code>
                <ArrowRight className={styles.rowArrow} aria-hidden="true" />
                <span className="visually-hidden">{t('colors.belongsTo')}</span>
                {c.tokenValue && <Swatch color={c.tokenValue} size="sm" />}
                <code className={styles.colorToken}>{c.token}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

/** A broken rule with its reason (`why`), the way agents get it too. */
export function RuleCard({ rule, t }: { rule: RuleView; t: T }) {
  return (
    <li className={styles.rule}>
      <div className={styles.ruleHead}>
        <span className={styles.ruleName}>{rule.rule}</span>
        <span className={styles.ruleLevel}>{t('rules.level', { level: rule.level })}</span>
        <code className={styles.ruleCode}>{rule.decision}</code>
      </div>
      {rule.why && <p className={styles.ruleWhy}>{rule.why}</p>}
      <p className={styles.fine}>
        <code>{rule.value}</code>
        {rule.nearest && (
          <>
            {' · '}
            <Rich message={{ key: 'rules.nearest', values: { token: rule.nearest } }} t={t} />
          </>
        )}
      </p>
    </li>
  )
}
