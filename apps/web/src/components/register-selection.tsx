'use client'

import { useTranslations } from 'next-intl'
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import type { TokenRow } from '@/lib/register-view'
import { CopyValue } from './copy-button'
import { Inspector, PropertyList } from './panel'
import styles from './register.module.css'
import { AliasChip, TokenPreview, TypeIcon } from './register-parts'

/*
 * A token chosen in the list shows at once. The full inspector (owner, code use, rules) comes from the
 * server and follows; until then the inspector draws what the row already knows: the value, its
 * preview, the alias and the CSS variable to copy. Nothing is decided here, so nothing is re-implemented.
 */

interface Pending {
  pending: TokenRow | undefined
  setPending: (row: TokenRow | undefined) => void
}

const PendingContext = createContext<Pending | null>(null)

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<TokenRow | undefined>(undefined)
  // Back and forward show what the URL says, never a row chosen before.
  useEffect(() => {
    const clear = () => setPending(undefined)
    window.addEventListener('popstate', clear)
    return () => window.removeEventListener('popstate', clear)
  }, [])
  const value = useMemo(() => ({ pending, setPending }), [pending])
  return <PendingContext.Provider value={value}>{children}</PendingContext.Provider>
}

/** The row chosen but not yet answered by the server, and the setter (no-ops outside a provider). */
export function usePendingSelection(): Pending {
  return useContext(PendingContext) ?? { pending: undefined, setPending: () => {} }
}

/**
 * The inspector slot: the server's inspector, or, while a newer choice is on its way, a quick one drawn
 * from the row. `selected` is the token the server rendered.
 */
export function PendingInspector({
  selected,
  backHref,
  children,
}: {
  selected: string | undefined
  backHref: string
  children: ReactNode
}) {
  const { pending, setPending } = usePendingSelection()
  // The server answered (or the selection moved elsewhere): its inspector is the truth again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the server's selection changes
  useEffect(() => setPending(undefined), [selected])
  if (!pending || pending.path === selected) return children
  return <QuickInspector row={pending} backHref={backHref} />
}

function QuickInspector({ row, backHref }: { row: TokenRow; backHref: string }) {
  const t = useTranslations('register')
  // The inspector itself, never wrapped: the layout docks it as the grid's direct child.
  return (
    <Inspector
      label={t('detail')}
      meta={
        <span className={styles.metaLine}>
          <TypeIcon type={row.type} />
          {t('token.meta', { type: t(`types.${row.type}`), group: row.group })}
        </span>
      }
      title={row.path}
      titleFont="mono"
      backHref={backHref}
      backLabel={t('back')}
    >
      <div className={styles.hero}>
        {row.preview.kind !== 'none' && (
          <TokenPreview preview={row.preview} size="lg" sample={t('token.sample')} />
        )}
        <div className={styles.heroValue}>
          <code className={styles.heroCode}>{row.value}</code>
          {row.alias && (
            <AliasChip
              target={row.alias}
              label={t('tokens.alias', { target: row.alias })}
              color={row.preview.kind === 'color' ? row.preview.css : undefined}
            />
          )}
        </div>
      </div>
      <PropertyList
        rows={[
          {
            label: t('token.props.variable'),
            value: (
              <CopyValue
                value={row.cssVar}
                label={t('tokens.copyVariable')}
                className={`${styles.copyVar} ${styles.copyVarInline}`}
                textClassName={styles.variable}
              />
            ),
          },
        ]}
      />
    </Inspector>
  )
}
