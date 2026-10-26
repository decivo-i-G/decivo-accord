/**
 * Contract presets for the shadcn/ui reference stack. `accord init` fills gaps in contracts it reads
 * from code: what code shows (variants from `cva`, sub-components) wins, the preset adds the API,
 * states, slots and accessibility expectations that code alone does not reveal.
 *
 * Framework-neutral on purpose: types are described, not tied to Radix or Base UI. The Figma
 * counterpart is the Obra shadcn/ui kit; mappings need the team's file key and are added later.
 */
export interface ContractPreset {
  description: string
  anatomy?: string[]
  variants?: Record<string, string[]>
  props?: Record<
    string,
    { type: string; required?: boolean; default?: unknown; values?: string[]; description?: string }
  >
  states?: string[]
  slots?: Record<string, 'required' | 'optional'>
  a11y?: { role?: string; min_target?: number; notes?: string }
}

/** WCAG 2.2 AA (2.5.8) minimum target size. Teams with stricter rules (decivo: 44px) raise it in their register. */
const TARGET = 24

export const SHADCN_PRESETS: Record<string, ContractPreset> = {
  Button: {
    description: 'Triggers an action. One primary button per view.',
    anatomy: ['root', 'icon', 'label'],
    variants: {
      variant: ['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'],
      size: ['default', 'sm', 'lg', 'icon'],
    },
    props: {
      type: { type: 'enum', values: ['button', 'submit', 'reset'], default: 'button' },
      disabled: { type: 'boolean', default: false },
    },
    states: ['default', 'hover', 'focus-visible', 'active', 'disabled'],
    slots: { label: 'required', icon: 'optional' },
    a11y: {
      role: 'button',
      min_target: TARGET,
      notes: 'Icon-only buttons need an accessible name (aria-label).',
    },
  },
  Badge: {
    description: 'Short status or category label. Not interactive.',
    anatomy: ['root'],
    variants: { variant: ['default', 'secondary', 'outline', 'destructive'] },
    states: ['default'],
    slots: { label: 'required' },
    a11y: { notes: 'Colour must not be the only carrier of meaning.' },
  },
  Input: {
    description: 'Single-line text entry.',
    anatomy: ['root'],
    props: {
      type: {
        type: 'enum',
        values: ['text', 'email', 'password', 'number', 'search', 'tel', 'url'],
        default: 'text',
      },
      disabled: { type: 'boolean', default: false },
      required: { type: 'boolean', default: false },
      placeholder: { type: 'string' },
    },
    states: ['default', 'focus-visible', 'disabled', 'invalid'],
    a11y: {
      role: 'textbox',
      min_target: TARGET,
      notes: 'Needs an associated Label; placeholder is not a label.',
    },
  },
  Label: {
    description: 'Names a form control.',
    anatomy: ['root'],
    props: { htmlFor: { type: 'string', required: true, description: 'Id of the labelled control' } },
    states: ['default', 'disabled'],
    slots: { label: 'required' },
  },
  Checkbox: {
    description: 'Binary or indeterminate choice.',
    anatomy: ['root', 'indicator'],
    props: {
      checked: { type: 'boolean | "indeterminate"', default: false },
      disabled: { type: 'boolean', default: false },
      required: { type: 'boolean', default: false },
    },
    states: ['unchecked', 'checked', 'indeterminate', 'focus-visible', 'disabled', 'invalid'],
    a11y: { role: 'checkbox', min_target: TARGET, notes: 'Clickable label counts towards the target size.' },
  },
  Select: {
    description: 'Choose one option from a list.',
    anatomy: ['root', 'trigger', 'value', 'content', 'item', 'label', 'separator'],
    props: {
      value: { type: 'string' },
      disabled: { type: 'boolean', default: false },
      required: { type: 'boolean', default: false },
    },
    states: ['closed', 'open', 'focus-visible', 'disabled', 'invalid'],
    slots: { placeholder: 'optional' },
    a11y: {
      role: 'combobox',
      min_target: TARGET,
      notes: 'Keyboard: arrows move, Enter selects, Escape closes.',
    },
  },
  Dialog: {
    description: 'Modal surface for a focused task.',
    anatomy: ['root', 'trigger', 'content', 'header', 'title', 'description', 'footer', 'close'],
    props: {
      open: { type: 'boolean' },
      modal: { type: 'boolean', default: true },
    },
    states: ['closed', 'open'],
    slots: { title: 'required', description: 'optional', footer: 'optional' },
    a11y: {
      role: 'dialog',
      notes: 'Focus is trapped and returns to the trigger; Escape closes; title names the dialog.',
    },
  },
  Tabs: {
    description: 'Switch between related views in place.',
    anatomy: ['root', 'list', 'trigger', 'content'],
    props: {
      value: { type: 'string' },
      orientation: { type: 'enum', values: ['horizontal', 'vertical'], default: 'horizontal' },
    },
    states: ['selected', 'unselected', 'focus-visible', 'disabled'],
    a11y: { role: 'tablist', min_target: TARGET, notes: 'Arrow keys move between tabs.' },
  },
  Table: {
    description: 'Tabular data.',
    anatomy: ['root', 'caption', 'header', 'body', 'footer', 'row', 'head', 'cell'],
    states: ['default', 'row-hover', 'row-selected'],
    slots: { caption: 'optional' },
    a11y: { role: 'table', notes: 'Give the table a caption or aria-label; header cells use scope.' },
  },
  Card: {
    description: 'Groups related content and actions.',
    anatomy: ['root', 'header', 'title', 'description', 'action', 'content', 'footer'],
    states: ['default'],
    slots: { title: 'optional', description: 'optional', content: 'required', footer: 'optional' },
  },
}

type Contract = Record<string, unknown>

/**
 * Fill gaps in a contract read from code. Values from code (variants, anatomy) are kept;
 * the preset only adds what is missing.
 */
export function applyPreset(contract: Contract): Contract {
  const preset = SHADCN_PRESETS[contract.name as string]
  if (!preset) return contract
  const out: Contract = { ...contract }
  if (!out.description) out.description = preset.description
  for (const key of ['anatomy', 'variants', 'props', 'states', 'slots', 'a11y'] as const) {
    if (out[key] === undefined && preset[key] !== undefined) out[key] = preset[key]
  }
  return out
}
