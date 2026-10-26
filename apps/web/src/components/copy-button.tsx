'use client'

import { useTranslations } from 'next-intl'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Button, type ButtonVariant, IconButton } from './button'
import { Check, Copy } from './icons'
import { useAnnounce } from './toast'

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fallback for browsers without the async clipboard (or without permission).
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

/**
 * Copies a value and remembers for two seconds that it did. The sentence for screen readers goes to the
 * app's one shared live region; only outside the app shell (no provider) does a button keep its own.
 */
function useCopy(value: string) {
  const t = useTranslations('ui')
  const announce = useAnnounce()
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async () => {
    const ok = await writeClipboard(value)
    setState(ok ? 'copied' : 'failed')
    announce?.(ok ? t('copiedValue', { value }) : t('copyFailed'))
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2000)
  }
  const status = state === 'copied' ? t('copiedValue', { value }) : state === 'failed' ? t('copyFailed') : ''
  const region = announce ? null : (
    <span className="visually-hidden" role="status">
      {status}
    </span>
  )
  return { state, copy, region }
}

/**
 * A value that copies itself on click, like Figma Dev Mode's code values: the value as text with a
 * quiet copy icon after it. The whole value is the target; the icon turns into a check once copied.
 */
export function CopyValue({
  value,
  label,
  className,
  textClassName,
  children,
}: {
  value: string
  /** What a click does, e.g. "CSS-Variable kopieren"; the value is added to the accessible name. */
  label: string
  className?: string | undefined
  textClassName?: string | undefined
  /** The value as shown (e.g. with search hits marked); defaults to the value itself. */
  children?: ReactNode
}) {
  const t = useTranslations('ui')
  const { state, copy, region } = useCopy(value)
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={copy}
        aria-label={`${state === 'copied' ? t('copied') : label}: ${value}`}
        title={label}
        data-copy=""
      >
        <code className={textClassName}>{children ?? value}</code>
        {state === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </button>
      {region}
    </>
  )
}

/**
 * Copies a value (CSS variable, token path, command) and says so: the icon turns into a check and a
 * live region announces "copied". Icon-only by default; `showValue` shows the value as the label.
 */
export function CopyButton({
  value,
  label,
  detail,
  showValue = false,
  text,
  variant = 'secondary',
}: {
  value: string
  /** What is copied, for the accessible name, e.g. "CSS-Variable kopieren". Defaults to "Kopieren". */
  label?: string | undefined
  /** Which one, added to the accessible name but not the tooltip ("Befehl kopieren: accord diff"). */
  detail?: string | undefined
  showValue?: boolean | undefined
  /** A visible label instead of an icon-only button, e.g. "Copy task for Claude Code". */
  text?: string | undefined
  variant?: ButtonVariant | undefined
}) {
  const t = useTranslations('ui')
  const { state, copy, region } = useCopy(value)
  const name = label ?? t('copy')
  const icon = state === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />

  return (
    <>
      {text ? (
        <Button variant={variant} icon={icon} onClick={copy} full>
          {state === 'copied' ? t('copied') : text}
        </Button>
      ) : showValue ? (
        <Button variant="quiet" icon={icon} onClick={copy} aria-label={`${name}: ${value}`}>
          <code>{value}</code>
        </Button>
      ) : (
        <IconButton
          label={state === 'copied' ? t('copied') : detail ? `${name}: ${detail}` : name}
          tip={state === 'copied' ? t('copied') : name}
          icon={icon}
          onClick={copy}
          tooltip="end"
        />
      )}
      {region}
    </>
  )
}
