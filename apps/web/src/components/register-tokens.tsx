'use client'

import type { TokenType } from '@decivo/accord-core'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { modeName } from '@/lib/mode-name'
import { registerHref } from '@/lib/register-href'
import type { ModeView } from '@/lib/register-modes'
import { leafName, suggestQuery, type TokenRow } from '@/lib/register-view'
import { Button } from './button'
import { CopyValue } from './copy-button'
import { EmptyState } from './empty-state'
import { ChevronRight, Inbox } from './icons'
import styles from './register.module.css'
import { AliasChip, Highlight, Ramp, TokenPreview } from './register-parts'
import { usePendingSelection } from './register-selection'
import { SearchField } from './search-field'
import { Swatch } from './swatch'
import { useListKeys, useSearchKeys, useSelectedInView, useUrlFilter } from './use-register-list'

interface Group {
  total: number
  families: Map<string, TokenRow[]>
  colors: string[]
}

/** Figma modes as the table needs them (no `covered` list). */
export type TableModes = Pick<ModeView, 'source' | 'main' | 'others' | 'values'>

/**
 * The ungrouped rest of a collection is semantic when none of its names ends in a scale step
 * (`-50`, `.600`): roles like `background`, `primary` or `sidebar-ring`. People look these up most,
 * so they come first under their own name, not last as "Other".
 */
const isSemantic = (rows: readonly TokenRow[]) => rows.every((r) => !/(^|[-._])\d+$/.test(r.name))

const familyKey = (group: string, family: string) => `${group}/${family}`
const familyId = (group: string, family: string) => `fam-${group}-${family || 'rest'}`

/** Registers with this many tokens or more start calm: only the first group open, its families folded. */
const CALM_FROM = 30

/** Open unless the default says closed; a toggle flips the default for that one key. */
const isOpen = (toggled: ReadonlySet<string>, key: string, byDefault: boolean) =>
  toggled.has(key) ? !byDefault : byDefault

/**
 * The token list, built for one job first: find a token and copy its CSS variable. The search sits
 * on top ("/" focuses it), every row copies its variable with one click, and large registers start
 * folded (the first group open, its families closed, each with its colour strip). With Figma modes,
 * each mode gets its value column, the way Figma's variables panel shows them. Owner and details
 * live in the inspector.
 */
export function TokenTable({
  rows,
  base,
  selected,
  initialQuery,
  initialType,
  open = {},
  modes,
}: {
  rows: TokenRow[]
  base: string
  selected?: string | undefined
  initialQuery?: string | undefined
  /** A type filter from the URL (`?type=color`), set from the inspector's "By type". */
  initialType?: string | undefined
  /** Open proposals per token path. */
  open?: Record<string, number> | undefined
  /** Figma's modes: one value column per mode. */
  modes?: TableModes | undefined
}) {
  const t = useTranslations('register')
  const { query, setQuery, filter, setFilter } = useUrlFilter('type', initialQuery, initialType)
  // Groups and families whose open state differs from the default (see `defaultOpen`).
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set())
  const [resetKey, setResetKey] = useState(0)
  const table = useRef<HTMLDivElement>(null)
  // A row chosen by click or key shows at once; the server's inspector follows.
  const { pending, setPending } = usePendingSelection()
  const byPath = useMemo(() => new Map(rows.map((r) => [r.path, r])), [rows])
  const onMove = useCallback(
    (link: HTMLAnchorElement) => setPending(byPath.get(link.dataset.path ?? '')),
    [byPath, setPending],
  )
  useListKeys(table, Boolean(selected), registerHref(base, { tab: 'tokens', q: query, filter }), onMove)
  const highlighted = pending?.path ?? selected
  // Counts the times a folded group opened for the selection, so the selected row scrolls into view.
  const [revealed, setRevealed] = useState(0)
  useSelectedInView(table, selected, revealed)
  const searchKeys = useSearchKeys(table)

  const words = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query])
  const visible = useMemo(
    () => rows.filter((r) => (!filter || r.type === filter) && words.every((w) => r.haystack.includes(w))),
    [rows, words, filter],
  )
  const searching = words.length > 0 || Boolean(filter)
  // A new search shows every hit: folding starts over from the default.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when searching starts or ends
  useEffect(() => setToggled(new Set()), [searching])

  const groups = useMemo(() => {
    const totals = new Map<string, number>()
    for (const r of rows) totals.set(r.group, (totals.get(r.group) ?? 0) + 1)
    const out = new Map<string, Group>()
    for (const r of visible) {
      const g = out.get(r.group) ?? {
        total: totals.get(r.group) ?? 0,
        families: new Map<string, TokenRow[]>(),
        colors: [] as string[],
      }
      const list = g.families.get(r.family) ?? []
      list.push(r)
      g.families.set(r.family, list)
      if (r.preview.kind === 'color') g.colors.push(r.preview.css)
      out.set(r.group, g)
    }
    // The rest goes first when it is the semantic layer, otherwise last ("Other").
    for (const g of out.values()) {
      const rest = g.families.get('')
      if (rest && g.families.size > 1) {
        g.families.delete('')
        if (isSemantic(rest)) g.families = new Map([['', rest], ...g.families])
        else g.families.set('', rest)
      }
    }
    return [...out]
  }, [rows, visible])

  // Types to filter by, in the order they first appear; a filter only when there is a choice.
  const types = useMemo(() => [...new Set(rows.map((r) => r.type))], [rows])
  const suggestion = visible.length === 0 ? suggestQuery(rows, query) : undefined

  // Calm by default: in a large register only the first group is open, with its families folded.
  const calm = rows.length >= CALM_FROM && !searching
  const firstGroup = groups[0]?.[0]
  const defaultOpen = (group: string, family?: string) =>
    !calm || (group === firstGroup && family === undefined)
  const others = modes?.others ?? []
  const columns = 3 + others.length

  // A selection inside a folded group (a deep link, the inspector's links) opens that group first.
  const selectedRow = rows.find((r) => r.path === selected)
  const selectedGroup = selectedRow?.group
  const selectedFamily = selectedRow?.family
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the selection moves
  useEffect(() => {
    if (selectedGroup === undefined || selectedFamily === undefined) return
    const key = familyKey(selectedGroup, selectedFamily)
    const shut = [
      ...(isOpen(toggled, selectedGroup, defaultOpen(selectedGroup)) ? [] : [selectedGroup]),
      ...(isOpen(toggled, key, defaultOpen(selectedGroup, selectedFamily)) ? [] : [key]),
    ]
    if (shut.length === 0) return
    const next = new Set(toggled)
    for (const k of shut) {
      if (next.has(k)) next.delete(k)
      else next.add(k)
    }
    setToggled(next)
    setRevealed((n) => n + 1)
  }, [selectedGroup, selectedFamily])

  const href = (path: string) => registerHref(base, { tab: 'tokens', q: query, filter, item: path })
  const choose = (row: TokenRow) => setPending(row.path === selected ? undefined : row)
  const restLabel = (list: readonly TokenRow[]) =>
    isSemantic(list) ? t('tokens.semantic') : t('tokens.other')

  if (rows.length === 0) return <EmptyState title={t('tokens.empty.title')} text={t('tokens.empty.text')} />

  const toggle = (key: string) =>
    setToggled((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div className={styles.listArea} data-list-area="">
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <SearchField
            key={resetKey}
            label={t('tokens.search')}
            hideLabel
            placeholder={t('tokens.placeholder')}
            defaultValue={query}
            onValueChange={setQuery}
            onKeyDown={searchKeys}
          />
        </div>
        {types.length > 1 && (
          <fieldset className={styles.typeFilter}>
            <legend className="visually-hidden">{t('tokens.typeFilter')}</legend>
            {[undefined, ...types].map((type) => (
              <button
                key={type ?? 'all'}
                type="button"
                className={styles.typeOption}
                aria-pressed={filter === type}
                onClick={() => setFilter(type)}
              >
                {type ? t(`types.${type as TokenType}`) : t('filter.all')}
              </button>
            ))}
          </fieldset>
        )}
      </div>

      {/* Only a search says how many it found; the live region announces it. */}
      <p
        className={`${styles.results} ${searching && visible.length > 0 ? '' : 'visually-hidden'}`}
        role="status"
      >
        {searching ? t('filter.results', { count: visible.length }) : ''}
      </p>

      {visible.length === 0 ? (
        <EmptyState
          title={t('tokens.noResults.title')}
          text={t('tokens.noResults.text')}
          action={
            suggestion ? (
              <Button
                onClick={() => {
                  setFilter(undefined)
                  setQuery(suggestion)
                  setResetKey((k) => k + 1)
                }}
              >
                {t('tokens.suggest', { query: suggestion })}
              </Button>
            ) : (
              <Button
                onClick={() => {
                  setFilter(undefined)
                  setQuery('')
                  setResetKey((k) => k + 1)
                }}
              >
                {query.trim() && filter
                  ? t('filter.resetAll')
                  : query.trim()
                    ? t('filter.clearSearch')
                    : t('filter.reset')}
              </Button>
            )
          }
        />
      ) : null}

      <div ref={table} className={styles.tableCard} hidden={visible.length === 0}>
        <table
          className={styles.tokenTable}
          aria-label={t('tokens.tableLabel')}
          data-modes={modes ? '' : undefined}
        >
          <thead>
            <tr>
              <th scope="col" className={styles.colName}>
                {t('tokens.columns.name')}
              </th>
              <th scope="col" className={styles.colValue}>
                {modes ? modeName(t, modes.main) : t('tokens.columns.value')}
              </th>
              {modes &&
                others.map((mode) => (
                  <th
                    key={mode}
                    scope="col"
                    className={`${styles.colValue} ${styles.colMode}`}
                    title={
                      modes.source === 'figma'
                        ? t('tokens.modes.onlyFigma', { main: modes.main })
                        : t('tokens.modes.fromRegister', { main: modeName(t, modes.main) })
                    }
                  >
                    <span className={styles.modeHead}>
                      {modeName(t, mode)}
                      {modes.source === 'figma' && (
                        <span className={styles.modeNote}>{t('tokens.modes.headNote')}</span>
                      )}
                    </span>
                  </th>
                ))}
              <th scope="col" className={styles.colVar}>
                <span className={styles.colVarText}>{t('tokens.columns.variable')}</span>
              </th>
            </tr>
          </thead>
          {groups.map(([group, g]) => {
            const shown = [...g.families.values()].reduce((n, l) => n + l.length, 0)
            const groupOpen = isOpen(toggled, group, defaultOpen(group))
            return (
              <tbody key={group} className={styles.group}>
                <tr className={styles.groupRow} id={`grp-${group}`}>
                  <th colSpan={columns} scope="rowgroup">
                    <span className={styles.groupHead}>
                      <button
                        type="button"
                        className={styles.groupToggle}
                        aria-expanded={groupOpen}
                        onClick={() => toggle(group)}
                      >
                        <ChevronRight aria-hidden="true" className={styles.chevron} />
                        <span className={styles.groupName}>{group}</span>
                        {/* A count only where it tells what is folded away; open groups show their rows. */}
                        {!groupOpen && shown > 1 && <span className={styles.filterCount}>{shown}</span>}
                        {!groupOpen && <Ramp colors={g.colors} />}
                      </button>
                    </span>
                  </th>
                </tr>
                {groupOpen &&
                  [...g.families].flatMap(([family, list]) => {
                    const key = familyKey(group, family)
                    const familyOpen = isOpen(toggled, key, defaultOpen(group, family))
                    const header =
                      g.families.size > 1 || family ? (
                        <tr key={`f-${family}`} className={styles.familyRow} id={familyId(group, family)}>
                          <th colSpan={columns} scope="rowgroup">
                            <button
                              type="button"
                              className={styles.familyToggle}
                              aria-expanded={familyOpen}
                              onClick={() => toggle(key)}
                            >
                              <ChevronRight aria-hidden="true" className={styles.chevron} />
                              {/* A family is a token path segment (mono); "Semantisch" is a word (sans). */}
                              <span className={family ? styles.familyName : styles.familyLabel}>
                                {family || restLabel(list)}
                              </span>
                              {!familyOpen && <span className={styles.filterCount}>{list.length}</span>}
                              <Ramp
                                colors={list.flatMap((r) =>
                                  r.preview.kind === 'color' ? [r.preview.css] : [],
                                )}
                              />
                            </button>
                          </th>
                        </tr>
                      ) : null
                    return [
                      header,
                      ...(familyOpen || !header
                        ? list.map((r) => (
                            <TokenTableRow
                              key={r.path}
                              row={r}
                              depth={header ? 2 : 1}
                              name={leafName(r.name, family)}
                              href={href}
                              onChoose={choose}
                              current={r.path === highlighted}
                              open={open[r.path] ?? 0}
                              words={words}
                              modes={modes}
                            />
                          ))
                        : []),
                    ]
                  })}
              </tbody>
            )
          })}
        </table>
      </div>
    </div>
  )
}

function TokenTableRow({
  row,
  depth,
  name,
  href,
  onChoose,
  current,
  open,
  words,
  modes,
}: {
  row: TokenRow
  /** 1 directly under a group, 2 under a family: the row is indented to its parent's label. */
  depth: 1 | 2
  /** The name as the tree shows it (without the family). */
  name: string
  href: (path: string) => string
  onChoose: (row: TokenRow) => void
  current: boolean
  open: number
  words: string[]
  modes?: TableModes | undefined
}) {
  const t = useTranslations('register')
  return (
    <tr className={styles.row} data-current={current || undefined} data-depth={depth}>
      <th scope="row" className={styles.nameCell}>
        <span className={styles.nameInner}>
          <TokenPreview preview={row.preview} sample={t('token.sample')} />
          <span className={styles.nameText}>
            <span className={styles.tokenLine}>
              <Link
                href={href(row.path)}
                className={styles.rowLink}
                aria-current={current ? 'true' : undefined}
                data-row-link=""
                data-path={row.path}
                scroll={false}
                title={row.path}
                aria-label={open > 0 ? `${row.path}, ${t('tokens.open', { count: open })}` : row.path}
                onClick={(e) => {
                  if (!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)) onChoose(row)
                }}
              >
                <Highlight text={name} words={words} />
              </Link>
              {/* One mark at most: deprecated says more than an open decision (the inspector has both). */}
              {row.deprecated ? (
                <span className={styles.deprecated}>{t('tokens.deprecated')}</span>
              ) : open > 0 ? (
                <span
                  className={styles.openMark}
                  title={t('tokens.open', { count: open })}
                  aria-hidden="true"
                >
                  <Inbox />
                </span>
              ) : null}
            </span>
            {/* On a phone the value moves under the name, so the name gets the full width. */}
            <code className={styles.nameValue}>{row.value}</code>
          </span>
        </span>
      </th>
      <td className={styles.valueCell}>
        {/* An alias shows its target only: the chip's swatch shows the colour, its name says the value. */}
        {row.alias ? (
          <AliasChip
            target={row.alias}
            href={href(row.alias)}
            label={t('tokens.aliasValue', { target: row.alias, value: row.value })}
            color={row.preview.kind === 'color' ? row.preview.css : undefined}
          />
        ) : (
          <code
            className={styles.value}
            title={row.value}
            style={row.preview.kind === 'fontFamily' ? { fontFamily: row.preview.css } : undefined}
          >
            <Highlight text={row.value} words={words} />
          </code>
        )}
      </td>
      {modes?.others.map((mode) => {
        const v = modes.values[row.path]?.[mode]
        return (
          <td key={mode} className={`${styles.valueCell} ${styles.colMode}`}>
            {v ? (
              <span className={styles.modeValue}>
                {v.color && <Swatch color={v.color} size="sm" />}
                <code className={styles.value} title={v.text}>
                  {v.text}
                </code>
              </span>
            ) : (
              <span className={styles.sameMode}>
                {t('tokens.modes.same', { mode: modeName(t, modes.main) })}
              </span>
            )}
          </td>
        )
      })}
      <td className={styles.colVar}>
        <CopyValue
          value={row.cssVar}
          label={t('tokens.copyVariable')}
          className={styles.copyVar}
          textClassName={styles.variable}
        >
          <Highlight text={row.cssVar} words={words} />
        </CopyValue>
      </td>
    </tr>
  )
}
