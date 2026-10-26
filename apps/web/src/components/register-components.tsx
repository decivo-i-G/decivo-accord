'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useMemo, useRef, useState } from 'react'
import { registerHref } from '@/lib/register-href'
import type { ComponentRow } from '@/lib/register-view'
import { Button } from './button'
import { EmptyState } from './empty-state'
import { ChevronRight, ToolIcon, X } from './icons'
import styles from './register.module.css'
import { SearchField } from './search-field'
import { StatusChip, type Tone } from './status-chip'
import ui from './ui.module.css'
import { useListKeys, useSearchKeys, useSelectedInView, useUrlFilter } from './use-register-list'

const STATUS_ORDER: ComponentRow['status'][] = ['stable', 'draft', 'deprecated']
const STATUS_TONE: Record<ComponentRow['status'], Tone> = {
  stable: 'success',
  draft: 'neutral',
  deprecated: 'warning',
}
const CODE_TONE: Record<ComponentRow['code'], Tone> = {
  inSync: 'success',
  missing: 'warning',
  noMapping: 'neutral',
}
/**
 * Component contracts as a searchable one-line table, like the assets panel in Figma: the name (a
 * Figma mark when mapped), the variant axes (`variant 6 · size 6`) and the number of props, aligned
 * so they compare at a glance. Files, options, states and owners live in the inspector.
 */
export function ComponentTable({
  rows,
  base,
  selected,
  initialQuery,
  initialStatus,
}: {
  rows: ComponentRow[]
  base: string
  selected?: string | undefined
  initialQuery?: string | undefined
  initialStatus?: string | undefined
}) {
  const t = useTranslations('register')
  const { query, setQuery, filter, setFilter } = useUrlFilter('status', initialQuery, initialStatus)
  const [resetKey, setResetKey] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  useListKeys(list, Boolean(selected), registerHref(base, { tab: 'components', q: query, filter }))
  useSelectedInView(list, selected)
  const searchKeys = useSearchKeys(list)

  const visible = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return rows.filter((r) => (!filter || r.status === filter) && words.every((w) => r.haystack.includes(w)))
  }, [rows, query, filter])
  const searching = query.trim() !== '' || Boolean(filter)
  // The usual status needs no chip on every row; only the exceptions get one, the rest a note.
  const statusCounts = STATUS_ORDER.map((s) => [s, rows.filter((r) => r.status === s).length] as const)
  const usual = [...statusCounts].sort((a, b) => b[1] - a[1])[0]?.[0]
  const drafts = rows.filter((r) => r.status === 'draft').length
  // A file in the repo is the normal case: the code column only names the exceptions.
  const allInSync = rows.every((r) => r.code === 'inSync')

  if (rows.length === 0)
    return (
      <EmptyState
        title={t('components.empty.title')}
        text={t('components.empty.text')}
        action={
          <details className={styles.more}>
            <summary>
              <ChevronRight aria-hidden="true" />
              {t('components.empty.how')}
            </summary>
            <p className={`${styles.moreBody} ${styles.fine}`}>{t('components.empty.howText')}</p>
          </details>
        }
      />
    )

  const href = (name: string) => registerHref(base, { tab: 'components', q: query, filter, item: name })

  return (
    <div className={styles.listArea} data-list-area="">
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <SearchField
            key={resetKey}
            label={t('components.search')}
            hideLabel
            placeholder={t('components.placeholder')}
            defaultValue={query}
            onValueChange={setQuery}
            onKeyDown={searchKeys}
          />
        </div>
        {filter && (
          <button type="button" className={ui.activeFilter} onClick={() => setFilter(undefined)}>
            {t(`components.status.${filter as ComponentRow['status']}`)}
            <X aria-hidden="true" />
            <span className="visually-hidden">{t('filter.reset')}</span>
          </button>
        )}
      </div>

      {/* Only a search says how many it found; the live region announces it. */}
      <p
        className={`${styles.results} ${searching && visible.length > 0 ? '' : 'visually-hidden'}`}
        role="status"
      >
        {searching ? t('filter.results', { count: visible.length }) : ''}
      </p>

      {usual === 'draft' && (
        <p className={styles.fine}>
          {drafts === rows.length
            ? t('components.allDraft', { count: drafts })
            : t('components.draftNote', { count: drafts })}
        </p>
      )}

      {visible.length === 0 && (
        <EmptyState
          title={t('components.noResults.title')}
          text={t('components.noResults.text')}
          action={
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
          }
        />
      )}

      <div ref={list} className={styles.tableCard} hidden={visible.length === 0}>
        <table className={styles.componentTable} aria-label={t('components.tableLabel')}>
          <thead>
            <tr>
              <th scope="col">{t('components.columns.name')}</th>
              <th scope="col" className={styles.colAxes}>
                {t('components.columns.variants')}
              </th>
              <th scope="col" className={styles.colNumber}>
                {t('components.columns.props')}
              </th>
              {!allInSync && <th scope="col">{t('components.columns.code')}</th>}
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => {
              const current = c.name === selected
              return (
                <tr key={c.name} className={styles.row} data-current={current || undefined}>
                  <th scope="row" className={styles.nameCell}>
                    <span className={styles.componentName}>
                      <span className={styles.nameLine}>
                        <Link
                          href={href(c.name)}
                          className={styles.rowLink}
                          aria-current={current ? 'true' : undefined}
                          data-row-link=""
                          scroll={false}
                        >
                          {c.name}
                        </Link>
                        {c.surfaces.figma && (
                          <span className={styles.componentFigma} title={t('components.figma')}>
                            <ToolIcon tool="figma" aria-hidden="true" />
                            <span className="visually-hidden">{t('components.figma')}</span>
                          </span>
                        )}
                        {c.status !== usual && (
                          <StatusChip tone={STATUS_TONE[c.status]} icon={null}>
                            {t(`components.status.${c.status}`)}
                          </StatusChip>
                        )}
                      </span>
                    </span>
                  </th>
                  <td className={styles.colAxes}>
                    {c.variants
                      .map((v) => t('components.axis', { axis: v.axis, count: v.options.length }))
                      .join(' · ')}
                  </td>
                  <td className={styles.colNumber}>{c.props > 0 ? c.props : ''}</td>
                  {!allInSync && (
                    <td>
                      {c.code !== 'inSync' && (
                        <StatusChip tone={CODE_TONE[c.code]}>{t(`components.code.${c.code}`)}</StatusChip>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
