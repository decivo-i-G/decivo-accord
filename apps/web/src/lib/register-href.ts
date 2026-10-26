/** Tabs of the register screen, in their order. */
export const REGISTER_TABS = ['tokens', 'components', 'rules'] as const
export type RegisterTab = (typeof REGISTER_TABS)[number]

/** URL state of the register: `?tab=&q=&type=&token=` (or `component=`, `rule=`). */
export interface RegisterState {
  tab: RegisterTab
  /** Search text of the list. */
  q?: string | undefined
  /** Token type or component status filter. */
  filter?: string | undefined
  /** The selected item: token path, component name or decision id. */
  item?: string | undefined
}

const ITEM_PARAM: Record<RegisterTab, string> = {
  tokens: 'token',
  components: 'component',
  rules: 'rule',
}
const FILTER_PARAM: Record<RegisterTab, string | undefined> = {
  tokens: 'type',
  components: 'status',
  rules: undefined,
}

/** Deep link into the register, so a search and a selection survive a reload or a shared link. */
export function registerHref(base: string, state: RegisterState): string {
  const params = new URLSearchParams()
  params.set('tab', state.tab)
  if (state.q?.trim()) params.set('q', state.q.trim())
  const filterParam = FILTER_PARAM[state.tab]
  if (filterParam && state.filter) params.set(filterParam, state.filter)
  if (state.item) params.set(ITEM_PARAM[state.tab], state.item)
  return `${base}?${params.toString()}`
}

const one = (params: Record<string, string | string[] | undefined>, key: string) => {
  const v = params[key]
  return (Array.isArray(v) ? v[0] : v) || undefined
}

/**
 * Links from before the rules tab had its name (`?tab=decisions&decision=D-001`): the word
 * "Entscheidungen" belongs to the inbox, so the tab moved to `rules`. Returns the new link, or
 * `undefined` when the params are current.
 */
export function legacyRegisterHref(
  base: string,
  params: Record<string, string | string[] | undefined>,
): string | undefined {
  if (one(params, 'tab') !== 'decisions') return undefined
  return registerHref(base, { tab: 'rules', q: one(params, 'q'), item: one(params, 'decision') })
}

/** Reads the register state from search params (unknown tabs fall back to tokens). */
export function readRegisterState(params: Record<string, string | string[] | undefined>): RegisterState {
  const requested = one(params, 'tab') === 'decisions' ? 'rules' : one(params, 'tab')
  const tab = REGISTER_TABS.includes(requested as RegisterTab) ? (requested as RegisterTab) : 'tokens'
  const filterParam = FILTER_PARAM[tab]
  return {
    tab,
    q: one(params, 'q'),
    filter: filterParam ? one(params, filterParam) : undefined,
    item: one(params, ITEM_PARAM[tab]) ?? (tab === 'rules' ? one(params, 'decision') : undefined),
  }
}
