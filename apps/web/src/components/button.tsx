import Link from 'next/link'
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react'
import styles from './button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'

/** Every button is one size: a 44px target (the brief's minimum), never a smaller variant. */
interface Look {
  variant?: ButtonVariant | undefined
  /** Stretch to the container width (mobile action bars). */
  full?: boolean | undefined
}

/** Class names of a button, for elements that are neither `<button>` nor a link (e.g. `<summary>`). */
export function buttonClass({ variant = 'secondary', full }: Look = {}, extra?: string): string {
  return [styles.button, styles[variant], full && styles.full, extra].filter(Boolean).join(' ')
}

type ButtonProps = Look &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    /** Icon before the label (decorative). */
    icon?: ReactNode
    /** Icon after the label (decorative). */
    iconAfter?: ReactNode
  }

/** A real `<button>`. `type` defaults to "button" so it never submits a form by accident. */
export function Button({
  variant,
  full,
  icon,
  iconAfter,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={buttonClass({ variant, full }, className)} {...rest}>
      {icon}
      {children}
      {iconAfter}
    </button>
  )
}

type LinkProps = Look &
  ComponentProps<typeof Link> & {
    icon?: ReactNode
    iconAfter?: ReactNode
  }

/** A link that looks like a button. Use it for navigation; use `Button` for actions. */
export function ButtonLink({ variant, full, icon, iconAfter, className, children, ...rest }: LinkProps) {
  return (
    <Link className={buttonClass({ variant, full }, className)} {...rest}>
      {icon}
      {children}
      {iconAfter}
    </Link>
  )
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** Accessible name, also shown as tooltip. */
  label: string
  /** A shorter tooltip when the name carries more than fits one ("Befehl kopieren" for "…: accord diff"). */
  tip?: string | undefined
  icon: ReactNode
  variant?: ButtonVariant | undefined
  /** Where the tooltip anchors, so it stays on screen near edges. */
  tooltip?: 'center' | 'start' | 'end' | undefined
  /** Show the tooltip above the button (controls at the bottom of the screen). */
  tooltipAbove?: boolean | undefined
}

/** A square icon-only button with an accessible name and a matching tooltip. */
export function IconButton({
  label,
  tip,
  icon,
  variant = 'quiet',
  tooltip = 'center',
  tooltipAbove = false,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const anchor = tooltip === 'start' ? styles.tipStart : tooltip === 'end' ? styles.tipEnd : undefined
  const above = tooltipAbove ? styles.tipAbove : undefined
  return (
    <button
      type={type}
      aria-label={label}
      className={buttonClass({ variant }, [styles.icon, anchor, above, className].filter(Boolean).join(' '))}
      {...rest}
    >
      {icon}
      <span className={styles.tip} aria-hidden="true">
        {tip ?? label}
      </span>
    </button>
  )
}

/** Icon-only link (e.g. "back" on mobile) with an accessible name and tooltip. */
export function IconLink({
  label,
  icon,
  variant = 'quiet',
  tooltip = 'center',
  className,
  ...rest
}: Omit<ComponentProps<typeof Link>, 'children'> & {
  label: string
  icon: ReactNode
  variant?: ButtonVariant | undefined
  tooltip?: 'center' | 'start' | 'end' | undefined
}) {
  const anchor = tooltip === 'start' ? styles.tipStart : tooltip === 'end' ? styles.tipEnd : undefined
  return (
    <Link
      aria-label={label}
      className={buttonClass({ variant }, [styles.icon, anchor, className].filter(Boolean).join(' '))}
      {...rest}
    >
      {icon}
      <span className={styles.tip} aria-hidden="true">
        {label}
      </span>
    </Link>
  )
}
