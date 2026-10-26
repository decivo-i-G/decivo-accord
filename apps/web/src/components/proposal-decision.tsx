'use client'

import { cssToColor } from '@decivo/accord-core'
import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import { decide, undoDecide, undoLatest } from '@/app/p/[project]/decisions/actions'
import type { DecideResult, FileKind } from '@/lib/decide'
import { decisionGate } from '@/lib/decision-gate'
import type { Option } from '@/lib/proposals'
import { LoadingDots } from './brand-dots'
import { Button } from './button'
import { CopyButton } from './copy-button'
import { Check, ChevronDown, Trash2, TriangleAlert, Undo2, X } from './icons'
import { focusInspectorTitle, focusTitleAfterNavigation, useShortcutsEnabled } from './inbox-keys'
import { DisclosureSummary, hueOf } from './proposal-parts'
import styles from './proposals.module.css'
import { Swatch } from './swatch'
import { useToast } from './toast'

interface DecisionSetup {
  project: string
  id: string
  kind: 'surface' | 'handoff'
  /** The source as an ICU select argument (`figma`, `pen`, `claude`), for the toasts. */
  tool: string
  /** Tokens a Figma/Pencil adoption deletes (asks again before adopting). */
  deletes: string[]
  /** The change breaks existing uses (asks again before adopting). */
  breaking: boolean
  /** Why adopting is impossible as it stands (a must rule), if it is. */
  adoptBlocked?: string | undefined
  defaultBy: string
  /** Where to go after deciding: the next open proposal, or the inbox. */
  nextHref: string
  /** This proposal, to come back to after an undo. */
  selfHref: string
  /** What Accord suggests (the one primary button follows it) and why, in one sentence. */
  recommend: 'adopt' | 'reset'
  recommendText: ReactNode
  /** Button labels that name the outcome ("#3c6681 behalten", "spacing.4 löschen …"). */
  labels: Record<Option, string>
  /** The consequence of each option, one sentence, shown before the click. */
  effects: Record<Option, ReactNode>
  /** A colour the button keeps or adopts, shown as a small swatch on it. */
  swatches?: Partial<Record<Option, string>> | undefined
  /** Deletions: places in the scanned code that use the deleted tokens (undefined: no code scanned). */
  uses?: number | undefined
}

interface DecisionState extends DecisionSetup {
  by: string
  setBy: (by: string) => void
  note: string
  setNote: (note: string) => void
  names: Record<string, string>
  setName: (value: string, token: string) => void
  confirming: boolean
  cancelConfirm: () => void
  /** "More" (ignore, note, who decides) is open. */
  moreOpen: boolean
  setMoreOpen: (open: boolean) => void
  /** Handoffs: the "Name them yourself" disclosure is open. */
  namesOpen: boolean
  setNamesOpen: (open: boolean) => void
  /** Handoffs: how many colours have a token name. */
  namedCount: number
  /** The option being written; it stays set after success until the next proposal opens. */
  pending: Option | undefined
  byError: boolean
  namesError: boolean
  submit: (option: Option, confirmed?: boolean) => void
}

const Ctx = createContext<DecisionState | null>(null)

function useDecision(): DecisionState {
  const state = useContext(Ctx)
  if (!state) throw new Error('Decision components need a <DecisionProvider>')
  return state
}

const KIND_ORDER: FileKind[] = ['register', 'css', 'changelog', 'agents', 'other']

/** The row of a proposal that is on its way out of the list (decided, the next one is loading). */
function markLeaving(id: string) {
  document.querySelector(`[data-proposal="${CSS.escape(id)}"]`)?.setAttribute('data-leaving', '')
}

/**
 * State of one decision (who, note, names for new colours, confirmation) shared by the fields and
 * the buttons in the inspector's footer. Decisions run on the server through Accord's own
 * `resolutionFor`, `planApply` and `writeApply`. The provider is keyed by the proposal: once a decision
 * is written it stays busy (buttons answer no second press) until the next proposal replaces it, and
 * only then confirms with the toast, so the toast never contradicts what is on screen.
 */
export function DecisionProvider({ children, ...props }: DecisionSetup & { children: ReactNode }) {
  const setup = props
  const t = useTranslations('proposals')
  const format = useFormatter()
  const router = useRouter()
  const { show } = useToast()
  const [by, setBy] = useState(setup.defaultBy)
  const [note, setNote] = useState('')
  const [names, setNames] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState<Option | undefined>(undefined)
  const [byError, setByError] = useState(false)
  const [namesError, setNamesError] = useState(false)
  const [moreOpen, setMoreOpen] = useState(!setup.defaultBy.trim())
  const [namesOpen, setNamesOpen] = useState(false)
  const [, startTransition] = useTransition()
  const gate = useRef(decisionGate())
  /** The confirmation, shown once the next proposal is on screen (or after a while, if it is slow). */
  const toast = useRef<(() => void) | undefined>(undefined)

  useEffect(
    () => () => {
      toast.current?.()
      toast.current = undefined
    },
    [],
  )

  const risky = setup.deletes.length > 0 || setup.breaking
  const named = Object.entries(names).filter(([, token]) => token.trim() !== '')
  const deletesKey = setup.deletes.join(', ')

  const message = useCallback(
    (result: Extract<DecideResult, { ok: true }>) => {
      if (result.option === 'reset' && setup.kind === 'handoff') return t('toast.resetHandoff')
      if (result.option === 'reset' && setup.deletes.length > 0)
        return t('toast.keep', { tokens: deletesKey, count: setup.deletes.length, tool: setup.tool })
      if (result.option === 'reset') return t('toast.reset', { tool: setup.tool })
      if (result.option !== 'adopt') return t(`toast.${result.option}`)
      const present = new Set(result.files.map((f) => f.kind))
      const kinds = format.list(
        KIND_ORDER.filter((k) => present.has(k)).map((k) => t(`fileKind.${k}`)),
        { type: 'conjunction' },
      )
      return result.tokens.length > 0 && result.tokens.length <= 2
        ? t('toast.adoptTokens', { tokens: result.tokens.join(', '), kinds })
        : t('toast.adopt', { kinds })
    },
    [t, format, setup.kind, setup.deletes.length, setup.tool, deletesKey],
  )

  const { project, id, kind, adoptBlocked, nextHref, selfHref } = setup
  const submit = useCallback(
    (option: Option, confirmed = false) => {
      if (gate.current.state !== 'idle') return
      if (option === 'adopt' && adoptBlocked) return
      if (!by.trim()) {
        setByError(true)
        setMoreOpen(true)
        requestAnimationFrame(() => document.getElementById('decide-by')?.focus())
        return
      }
      if (option === 'adopt' && kind === 'handoff' && named.length === 0) {
        setNamesError(true)
        setNamesOpen(true)
        requestAnimationFrame(() => {
          const field = document.querySelector<HTMLInputElement>('[data-color-name]')
          field?.scrollIntoView({ block: 'center' })
          field?.focus({ preventScroll: true })
        })
        return
      }
      if (option === 'adopt' && risky && !confirmed) {
        setConfirming(true)
        return
      }
      if (!gate.current.start()) return
      setConfirming(false)
      setPending(option)
      startTransition(async () => {
        let result: DecideResult
        try {
          result = await decide({
            project,
            id,
            option,
            by: by.trim(),
            note: note.trim() || undefined,
            names: named.map(([value, token]) => ({ value, token: token.trim() })),
            confirmed,
          })
        } catch {
          gate.current.fail()
          show({ message: t('error.unknown'), tone: 'danger' })
          setPending(undefined)
          return
        }
        if (!result.ok) {
          gate.current.fail()
          setPending(undefined)
          show({ message: t(`error.${result.code}`, { detail: result.detail ?? '' }), tone: 'danger' })
          if (result.code === 'not_found' || result.code === 'already_resolved') router.refresh()
          return
        }
        // Written. The buttons stay busy and the row fades out until the next proposal is here.
        gate.current.done()
        markLeaving(id)
        const undo = result.undo
        const confirmation = {
          message: message(result),
          tone: 'success' as const,
          duration: 10_000,
          action: {
            label: t('toast.undo'),
            onClick: () => {
              void undoDecide(project, undo).then((ok) => {
                show(
                  ok
                    ? { message: t('toast.undone'), tone: 'info' }
                    : { message: t('toast.undoFailed'), tone: 'warning' },
                )
                if (ok) {
                  focusTitleAfterNavigation()
                  router.push(selfHref, { scroll: false })
                }
                router.refresh()
              })
            },
          },
        }
        toast.current = () => show(confirmation)
        // A slow answer still gets its confirmation.
        window.setTimeout(() => {
          toast.current?.()
          toast.current = undefined
        }, 6_000)
        focusTitleAfterNavigation()
        router.push(nextHref, { scroll: false })
      })
    },
    [project, id, kind, adoptBlocked, nextHref, selfHref, by, note, named, risky, router, show, t, message],
  )

  const value = useMemo<DecisionState>(
    () => ({
      ...setup,
      by,
      setBy: (v) => {
        setBy(v)
        if (v.trim()) setByError(false)
      },
      note,
      setNote,
      names,
      setName: (color, token) => {
        setNames((all) => ({ ...all, [color]: token }))
        if (token.trim()) setNamesError(false)
      },
      confirming,
      cancelConfirm: () => setConfirming(false),
      moreOpen,
      setMoreOpen,
      namesOpen,
      setNamesOpen,
      namedCount: named.length,
      pending,
      byError,
      namesError,
      submit,
    }),
    [
      setup,
      by,
      note,
      names,
      confirming,
      moreOpen,
      namesOpen,
      named.length,
      pending,
      byError,
      namesError,
      submit,
    ],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * An optional note, inside "More". Who decides comes from git config without asking (it shows in
 * the decided note, the history and the CHANGELOG); the field appears only when git config has no
 * name.
 */
function DecisionFields() {
  const t = useTranslations('proposals')
  const d = useDecision()
  const askBy = !d.defaultBy.trim() || d.byError
  return (
    <div className={styles.fields}>
      <div className={styles.field}>
        <label htmlFor="decide-note">{t('form.note')}</label>
        <textarea
          id="decide-note"
          className={styles.textarea}
          value={d.note}
          placeholder={t('form.notePlaceholder')}
          onChange={(e) => d.setNote(e.target.value)}
          rows={2}
        />
      </div>
      {askBy && (
        <div className={styles.field}>
          <label htmlFor="decide-by">{t('form.by')}</label>
          <input
            id="decide-by"
            className={styles.input}
            value={d.by}
            onChange={(e) => d.setBy(e.target.value)}
            autoComplete="name"
            aria-invalid={d.byError || undefined}
            aria-describedby="decide-by-hint"
            required
          />
          <span id="decide-by-hint" className={d.byError ? styles.fieldError : styles.fieldHint}>
            {d.byError ? t('form.byMissing') : t('form.byHint')}
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * "+171" at the end of a handoff's colour strip: opens "Name them yourself" and moves focus to its
 * first field, where the colours are named and adopted.
 */
export function OpenNames({ count, label }: { count: number; label: string }) {
  const t = useTranslations('proposals')
  const d = useDecision()
  return (
    <button
      type="button"
      className={styles.stripMoreButton}
      aria-label={label}
      title={label}
      aria-controls="decide-names"
      onClick={() => {
        d.setNamesOpen(true)
        requestAnimationFrame(() => {
          const field = document.querySelector<HTMLInputElement>('[data-color-name]')
          field?.scrollIntoView({ block: 'center' })
          field?.focus({ preventScroll: true })
        })
      }}
    >
      {t('colors.moreNew', { count })}
    </button>
  )
}

/** A token name to suggest for a colour: its hue family and lightness (`color.blue.700`). */
function nameFor(value: string): string {
  const color = cssToColor(value)
  const [r = 0, g = 0, b = 0] = (color?.components ?? []).map((c) => (typeof c === 'number' ? c : 0))
  // A transparency is an overlay, named by its opacity (`color.overlay.8`).
  if (color?.alpha !== undefined && color.alpha < 1) return `color.overlay.${Math.round(color.alpha * 100)}`
  const light = (Math.max(r, g, b) + Math.min(r, g, b)) / 2
  const step = Math.min(9, Math.max(1, Math.round((1 - light) * 10))) * 100
  return `color.${hueOf(color)}.${step}`
}

/**
 * Handoffs name no tokens. Naming new colours is the exception, so it waits behind "Name them
 * yourself" (closed): the person names the colours that should go into the register. As soon as one
 * has a name, the footer's one primary button adopts just those ("Adopt 2 colours"); there is no
 * second commit button in here.
 */
export function HandoffNames({
  colors,
  more,
  command,
}: {
  colors: { value: string; count: number; label: string }[]
  more: number
  command: string
}) {
  const t = useTranslations('proposals')
  const d = useDecision()
  if (colors.length === 0) return null
  return (
    <details
      id="decide-names"
      className={styles.namesBox}
      open={d.namesOpen}
      onToggle={(e) => d.setNamesOpen(e.currentTarget.open)}
    >
      <DisclosureSummary>{t('form.namesTitle')}</DisclosureSummary>
      {d.namesOpen && (
        <div className={styles.names}>
          <p className={styles.fine}>{t('form.namesHint')}</p>
          <ul className={styles.nameList}>
            {colors.map((c) => {
              const id = `name-${c.value.replace(/[^a-z0-9]/gi, '')}`
              return (
                <li key={c.value} className={styles.nameRow}>
                  <Swatch color={c.value} />
                  <span className={styles.nameValue}>
                    <code>{c.label}</code>
                    <span className={styles.muted}>{t('colors.count', { count: c.count })}</span>
                  </span>
                  <label htmlFor={id} className="visually-hidden">
                    {t('form.nameLabel', { value: c.label })}
                  </label>
                  <input
                    id={id}
                    data-color-name
                    className={styles.input}
                    value={d.names[c.value] ?? ''}
                    placeholder={t('form.namePlaceholder', { name: nameFor(c.value) })}
                    onChange={(e) => d.setName(c.value, e.target.value)}
                    aria-invalid={d.namesError || undefined}
                    aria-describedby={d.namesError ? 'names-error' : undefined}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </li>
              )
            })}
          </ul>
          {d.namesError && (
            <p id="names-error" className={styles.fieldError} role="alert">
              {t('form.namesMissing')}
            </p>
          )}
          {more > 0 && (
            <details className={styles.devs}>
              <DisclosureSummary>{t('form.forDevs')}</DisclosureSummary>
              <p className={styles.fine}>{t('form.namesMore', { count: more })}</p>
              <span className={styles.command}>
                <code>{command}</code>
                <CopyButton value={command} />
              </span>
            </details>
          )}
        </div>
      )}
    </details>
  )
}

/**
 * The button area: the suggestion in one sentence, its option as the one primary button with its
 * consequence right under it, the opposite as one quiet button, and "More" (ignore, a note,
 * who decides). Every button names its outcome and describes its consequence (aria-describedby); the
 * line under the primary follows the button in focus or under the pointer. Deletions and breaking
 * changes ask once more, with the safe "Cancel" focused. While a decision is written, and until the
 * next proposal is on screen, the buttons stay busy and answer no second press; the pressed button
 * keeps focus, so focus never falls to <body>. Handoffs adopt from "Name them yourself".
 */
export function DecisionButtons() {
  const t = useTranslations('proposals')
  const d = useDecision()
  const keysOn = useShortcutsEnabled()
  const handoff = d.kind === 'handoff'
  const area = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState<Option | undefined>(undefined)

  // The sticky footer must never hide what keyboard focus scrolls to (WCAG 2.4.11): the inspector
  // (and on phones the page) keeps a bottom scroll padding as tall as the footer.
  useEffect(() => {
    const footer = area.current?.parentElement
    const aside = footer?.closest('aside')
    if (!footer || !aside || typeof ResizeObserver === 'undefined') return
    const root = document.documentElement
    const observer = new ResizeObserver(() => {
      aside.style.setProperty('--inspector-footer', `${footer.offsetHeight}px`)
      root.style.setProperty('--inspector-footer', `${footer.offsetHeight}px`)
    })
    observer.observe(footer)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--inspector-footer')
    }
  }, [])

  // Asking again: focus the safe choice. Back from asking: focus Adopt again, never <body>.
  const wasConfirming = useRef(false)
  useEffect(() => {
    if (d.confirming) document.getElementById('decide-cancel')?.focus()
    else if (wasConfirming.current && !d.pending) document.getElementById('decide-adopt')?.focus()
    wasConfirming.current = d.confirming
  }, [d.confirming, d.pending])

  const onEscape = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Escape') d.cancelConfirm()
  }

  if (d.confirming)
    return (
      <div ref={area} className={styles.confirm}>
        <p id="confirm-text" className={styles.confirmText} role="alert">
          <TriangleAlert aria-hidden="true" />
          {d.deletes.length > 0
            ? t('actions.confirmDeletionText', {
                tokens: d.deletes.join(', '),
                scanned: d.uses === undefined ? 'no' : 'yes',
                uses: d.uses ?? 0,
              })
            : t('actions.confirmBreakingText')}
        </p>
        <div className={styles.buttonsStack}>
          <Button
            id="decide-confirm"
            variant="danger"
            full
            icon={d.deletes.length > 0 ? <Trash2 aria-hidden="true" /> : undefined}
            aria-describedby="confirm-text"
            onClick={() => d.submit('adopt', true)}
            onKeyDown={onEscape}
          >
            {d.deletes.length > 0
              ? t('actions.confirmDeletion', { tokens: d.deletes.join(', ') })
              : t('actions.confirm')}
          </Button>
          <Button id="decide-cancel" full onClick={d.cancelConfirm} onKeyDown={onEscape}>
            {t('actions.cancel')}
          </Button>
        </div>
      </div>
    )

  // Handoffs: once a colour has a name, adopting the named ones is what the person prepared, so it
  // becomes the one primary button and "Adopt nothing" the quiet alternative.
  const named = handoff && d.namedCount > 0
  // A locked adoption is no option at all: the suggestion is to keep the register, and Adopt is not offered.
  const primary: Option = named ? 'adopt' : d.adoptBlocked ? 'reset' : d.recommend
  const reason = d.adoptBlocked ? t('actions.blocked') : d.recommendText
  const busy = d.pending !== undefined
  // The one alternative that is the opposite of the suggestion. Ignoring waits under "More"; a
  // handoff has no Ignore (it would end like "Adopt nothing"), and adopts only from named colours.
  const opposite: Option | undefined =
    primary === 'adopt' ? 'reset' : handoff || d.adoptBlocked ? undefined : 'adopt'
  const labels: Record<Option, string> = named
    ? { ...d.labels, adopt: t('form.adoptNamed', { count: d.namedCount }) }
    : d.labels
  const effects: Record<Option, ReactNode> = named
    ? { ...d.effects, adopt: t('effectShort.adoptNamed', { count: d.namedCount }) }
    : d.effects
  const icon = (option: Option): ReactNode => {
    // The kept or adopted colour as a small swatch on the quiet button only: on the filled primary
    // it would melt into the button's own colour and read as an empty checkbox.
    const swatch = option === primary ? undefined : d.swatches?.[option]
    if (swatch) return <Swatch color={swatch} size="sm" />
    if (option === 'adopt')
      return d.deletes.length > 0 ? <Trash2 aria-hidden="true" /> : <Check aria-hidden="true" />
    if (option === 'reset') return <Undo2 aria-hidden="true" />
    return <X aria-hidden="true" />
  }
  const key: Record<Option, string> = { adopt: 'A', reset: 'R', reject: 'X' }
  const button = (option: Option) => (
    <Button
      key={option}
      id={`decide-${option}`}
      variant={option === primary ? 'primary' : 'quiet'}
      full={option === primary}
      icon={d.pending === option ? <LoadingDots /> : icon(option)}
      onClick={() => d.submit(option)}
      onFocus={() => setShown(option)}
      onBlur={() => setShown(undefined)}
      onMouseEnter={() => setShown(option)}
      onMouseLeave={() => setShown(undefined)}
      aria-disabled={busy || undefined}
      aria-busy={d.pending === option || undefined}
      aria-describedby={`decide-effect-${option}`}
      aria-keyshortcuts={keysOn ? (option === primary ? `${key[option]} Enter` : key[option]) : undefined}
      data-recommended={option === primary ? '' : undefined}
    >
      <span className={styles.buttonLabel}>
        {d.pending === option ? t('actions.working') : labels[option]}
      </span>
    </Button>
  )
  const effect = shown && shown !== 'reject' ? shown : primary

  return (
    <div
      ref={area}
      className={styles.decision}
      aria-busy={busy || undefined}
      data-deciding={busy ? '' : undefined}
    >
      {!named && (
        <p className={styles.recommend}>
          <strong>{t('actions.recommended')}</strong> {reason}
        </p>
      )}
      {button(primary)}
      {/* The consequence before the click; screen readers get it as each button's description. */}
      <p className={styles.effect} aria-hidden="true">
        {effects[effect]}
      </p>
      {(['adopt', 'reset', 'reject'] as const).map((o) => (
        <span key={o} id={`decide-effect-${o}`} hidden>
          {effects[o]}
        </span>
      ))}
      <div className={styles.alternatives}>
        {opposite && button(opposite)}
        <Button
          id="decide-more-toggle"
          variant="quiet"
          className={styles.moreToggle}
          iconAfter={<ChevronDown aria-hidden="true" className={styles.moreChevron} />}
          aria-expanded={d.moreOpen}
          aria-controls="decide-more"
          onClick={() => d.setMoreOpen(!d.moreOpen)}
        >
          {t('actions.more')}
        </Button>
      </div>
      <div id="decide-more" className={styles.moreBox} hidden={!d.moreOpen}>
        {!handoff && (
          <div className={styles.moreOption}>
            {button('reject')}
            <p className={styles.fine}>{d.effects.reject}</p>
          </div>
        )}
        <DecisionFields />
      </div>
    </div>
  )
}

/**
 * The decided view: take the decision back while Accord still can (a few minutes, the same undo as
 * the toast's), as a quiet secondary button next to the note.
 */
export function UndoDecision({ project, id }: { project: string; id: string }) {
  const t = useTranslations('proposals')
  const router = useRouter()
  const { show } = useToast()
  const [pending, startTransition] = useTransition()
  // Once undone, this button leaves with the decided view: focus goes to the title, never to <body>.
  const undone = useRef(false)
  useEffect(
    () => () => {
      if (undone.current) requestAnimationFrame(() => focusInspectorTitle())
    },
    [],
  )
  return (
    <Button
      icon={<Undo2 aria-hidden="true" />}
      aria-disabled={pending || undefined}
      aria-busy={pending || undefined}
      onClick={() => {
        if (pending) return
        startTransition(async () => {
          const ok = await undoLatest(project, id).catch(() => false)
          show(
            ok
              ? { message: t('toast.undone'), tone: 'info' }
              : { message: t('toast.undoFailed'), tone: 'warning' },
          )
          undone.current = ok
          router.refresh()
        })
      }}
    >
      {pending && <LoadingDots />}
      {t('toast.undo')}
    </Button>
  )
}

/**
 * "Adopt all safe": the proposals from their owner that break no rule, adopted one after the other
 * through the same server action (Accord's own resolution, plan and write), with one undo for all.
 */
export function BulkAdopt({ project, ids, by }: { project: string; ids: string[]; by: string }) {
  const t = useTranslations('proposals')
  const format = useFormatter()
  const router = useRouter()
  const { show } = useToast()
  const [pending, startTransition] = useTransition()

  const run = () =>
    startTransition(async () => {
      const undos: string[] = []
      const kinds = new Set<FileKind>()
      let error: string | undefined
      for (const id of ids) {
        let result: DecideResult
        try {
          result = await decide({ project, id, option: 'adopt', by })
        } catch {
          error = t('error.unknown')
          break
        }
        if (!result.ok) {
          error = t(`error.${result.code}`, { detail: result.detail ?? '' })
          break
        }
        undos.push(result.undo)
        for (const f of result.files) kinds.add(f.kind)
      }
      const list = format.list(
        KIND_ORDER.filter((k) => kinds.has(k)).map((k) => t(`fileKind.${k}`)),
        { type: 'conjunction' },
      )
      const undoAll = () => {
        void (async () => {
          let ok = true
          for (const undo of [...undos].reverse()) ok = (await undoDecide(project, undo)) && ok
          show(
            ok
              ? { message: t('toast.undone'), tone: 'info' }
              : { message: t('toast.undoFailed'), tone: 'warning' },
          )
          router.refresh()
        })()
      }
      if (undos.length > 0)
        show({
          message: error
            ? t('bulk.partial', { done: undos.length, count: ids.length, error })
            : t('bulk.toast', { count: undos.length, kinds: list }),
          tone: error ? 'warning' : 'success',
          duration: 10_000,
          action: { label: t('toast.undo'), onClick: undoAll },
        })
      else if (error) show({ message: error, tone: 'danger' })
      router.refresh()
      focusInspectorTitle()
    })

  return (
    <Button
      icon={<Check aria-hidden="true" />}
      onClick={run}
      disabled={pending}
      aria-busy={pending || undefined}
    >
      {pending && <LoadingDots />}
      {pending ? t('actions.working') : t('bulk.adopt', { count: ids.length })}
    </Button>
  )
}
