import type { Owner, TokenType } from '@decivo/accord-core'
import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import type { Preview } from '@/lib/register-view'
import {
  ArrowRight,
  Bold,
  BookOpen,
  Braces,
  Code,
  Hash,
  Palette,
  PenTool,
  Ruler,
  Spline,
  SquareStack,
  Timer,
  Type,
} from './icons'
import styles from './register.module.css'

/*
 * Small building blocks of the register screen. No hooks, so the client tables and the server
 * inspector draw tokens the same way. Every value shown here is data from the customer's register,
 * passed in through CSS custom properties, never a design value of this app.
 */

const TYPE_ICON: Partial<Record<TokenType, ReactNode>> = {
  color: <Palette aria-hidden="true" />,
  dimension: <Ruler aria-hidden="true" />,
  fontFamily: <Type aria-hidden="true" />,
  fontWeight: <Bold aria-hidden="true" />,
  typography: <Type aria-hidden="true" />,
  number: <Hash aria-hidden="true" />,
  duration: <Timer aria-hidden="true" />,
  cubicBezier: <Spline aria-hidden="true" />,
  transition: <Spline aria-hidden="true" />,
  shadow: <SquareStack aria-hidden="true" />,
}

/** The variable-type icon Figma shows next to a variable name. Decorative. */
export function TypeIcon({ type }: { type: TokenType }) {
  return (
    <span className={styles.typeIcon} aria-hidden="true">
      {TYPE_ICON[type] ?? <Braces aria-hidden="true" />}
    </span>
  )
}

const OWNER_ICON: Record<Owner, ReactNode> = {
  design: <PenTool aria-hidden="true" />,
  code: <Code aria-hidden="true" />,
  register: <BookOpen aria-hidden="true" />,
}

/** Who decides a value: icon plus word, never colour alone. */
export function OwnerChip({ owner, label }: { owner: Owner; label: string }) {
  return (
    <span className={styles.owner} data-owner={owner}>
      {OWNER_ICON[owner]}
      {label}
    </span>
  )
}

/**
 * `→ blue.600` as a chip, like Figma's variable alias pill: arrow icon, the resolved colour as a small
 * swatch, the target's name. A link to that token when `href` is set.
 */
export function AliasChip({
  target,
  href,
  label,
  color,
}: {
  target: string
  href?: string | undefined
  label: string
  /** CSS colour the alias resolves to, drawn inside the chip. */
  color?: string | undefined
}) {
  const content = (
    <>
      <ArrowRight aria-hidden="true" className={styles.aliasArrow} />
      {color && (
        <span className={styles.aliasSwatch} style={cssVars({ '--pv-color': color })} aria-hidden="true" />
      )}
      <span className={styles.aliasName}>{target}</span>
    </>
  )
  // The link is a full 44px target; the chip inside it keeps its quiet 24px look.
  return href ? (
    <Link href={href} className={styles.aliasLink} aria-label={label} title={label} scroll={false}>
      <span className={styles.alias}>{content}</span>
    </Link>
  ) : (
    <span className={styles.alias} title={label}>
      {content}
    </span>
  )
}

/** A file path that may wrap after each `/` instead of in the middle of a name. */
export function BreakablePath({ path }: { path: string }) {
  const parts = path.split('/')
  return (
    <code>
      {parts.map((part, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: path segments may repeat; the position is the identity
        <span key={i}>
          {part}
          {i < parts.length - 1 && (
            <>
              /<wbr />
            </>
          )}
        </span>
      ))}
    </code>
  )
}

const cssVars = (vars: Record<string, string | number>) => vars as CSSProperties

/**
 * The value drawn the way a design tool would: swatch, rounded box, bar, "Aa" in the size or
 * weight, the family's own typeface, a duration bar, an easing curve or a shadowed card.
 * `size="lg"` is the inspector's large stage.
 */
export function TokenPreview({
  preview,
  size = 'sm',
  sample,
}: {
  preview: Preview
  size?: 'sm' | 'lg' | undefined
  /** Sample text for font families and weights (translated). */
  sample: string
}) {
  const large = size === 'lg'
  const box = (className: string | undefined, style: CSSProperties, children?: ReactNode) => (
    <span
      className={`${styles.preview} ${large ? styles.previewLg : ''}`}
      data-kind={preview.kind}
      aria-hidden="true"
    >
      <span className={className} style={style}>
        {children}
      </span>
    </span>
  )
  switch (preview.kind) {
    case 'color':
      return box(styles.pvColor, cssVars({ '--pv-color': preview.css }))
    case 'radius':
      // One corner, zoomed: the curve is what a designer compares, not a whole box.
      return box(styles.pvRadius, cssVars({ '--pv-radius': preview.css }))
    case 'length':
      // A bar as long as the value (capped), with a tick at each end like a ruler.
      return box(styles.pvLength, cssVars({ '--pv-length': preview.css }), <span className={styles.pvRule} />)
    case 'fontSize':
      return box(styles.pvText, cssVars({ '--pv-size': preview.css }), 'Aa')
    case 'fontFamily':
      return box(styles.pvText, cssVars({ '--pv-font': preview.css }), large ? sample : 'Aa')
    case 'fontWeight':
      return box(styles.pvText, cssVars({ '--pv-weight': preview.weight }), large ? sample : 'Aa')
    case 'duration':
      return box(styles.pvDuration, cssVars({ '--pv-ratio': Math.min(1, preview.ms / 1000) }))
    case 'easing': {
      const [x1, y1, x2, y2] = preview.points
      // Unit square, y up; a little room for overshooting curves.
      const pt = (x: number, y: number) => `${x * 20 + 2} ${22 - y * 20}`
      return (
        <span
          className={`${styles.preview} ${large ? styles.previewLg : ''}`}
          data-kind="easing"
          aria-hidden="true"
        >
          <svg className={styles.pvEasing} viewBox="0 -4 24 32" focusable="false" aria-hidden="true">
            <path className={styles.pvEasingGuide} d={`M${pt(0, 0)} L${pt(1, 1)}`} />
            <path d={`M${pt(0, 0)} C${pt(x1, y1)} ${pt(x2, y2)} ${pt(1, 1)}`} />
          </svg>
        </span>
      )
    }
    case 'shadow':
      return box(styles.pvShadow, cssVars({ '--pv-shadow': preview.css }))
    default:
      return null
  }
}

/** A row of small swatches: a colour scale at a glance (Figma's collection header). */
export function Ramp({ colors }: { colors: string[] }) {
  if (colors.length < 2) return null
  return (
    <span className={styles.ramp} aria-hidden="true">
      {colors.slice(0, 16).map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a scale may repeat a colour; the position is the identity
        <span key={i} className={styles.rampStep} style={cssVars({ '--pv-color': c })} />
      ))}
    </span>
  )
}

/** `text` with every search word marked (`<mark>`), case-insensitive. */
export function Highlight({ text, words }: { text: string; words: readonly string[] }) {
  const needles = words.filter(Boolean)
  if (needles.length === 0) return text
  const lower = text.toLowerCase()
  const marks: boolean[] = new Array(text.length).fill(false)
  for (const w of needles) {
    for (let i = lower.indexOf(w); i !== -1; i = lower.indexOf(w, i + 1)) marks.fill(true, i, i + w.length)
  }
  const parts: { text: string; mark: boolean }[] = []
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1]
    if (last && last.mark === marks[i]) last.text += text[i]
    else parts.push({ text: text[i] ?? '', mark: marks[i] ?? false })
  }
  return (
    <>
      {parts.map((p, i) =>
        p.mark ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts of one string; the position is the identity
          <mark key={i} className={styles.match}>
            {p.text}
          </mark>
        ) : (
          p.text
        ),
      )}
    </>
  )
}
