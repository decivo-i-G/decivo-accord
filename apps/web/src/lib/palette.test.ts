import { describe, expect, it } from 'vitest'
import { type PaletteItem, rankOf, searchPalette } from './palette'

const items: PaletteItem[] = [
  { group: 'pages', key: 'page:decisions', label: 'Entscheidungen', href: '/p/acme/decisions' },
  { group: 'pages', key: 'page:register', label: 'Register', href: '/p/acme/register' },
  {
    group: 'proposals',
    key: 'proposal:P-1',
    label: 'radius.card geändert',
    href: '/p/acme/decisions?id=P-1',
  },
  {
    group: 'tokens',
    key: 'token:color.secondary',
    label: 'color.secondary',
    href: '/p/acme/register?tab=tokens&token=color.secondary',
    keywords: 'color.secondary #6b7280 --color-secondary',
  },
  {
    group: 'tokens',
    key: 'token:color.primary',
    label: 'color.primary',
    href: '/p/acme/register?tab=tokens&token=color.primary',
    keywords: 'color.primary #3c6681 --color-primary',
  },
  {
    group: 'tokens',
    key: 'token:radius.card',
    label: 'radius.card',
    href: '/p/acme/register?tab=tokens&token=radius.card',
  },
  { group: 'components', key: 'component:Button', label: 'Button', href: '/p/acme/register?tab=components' },
  {
    group: 'decisions',
    key: 'decision:D-002',
    label: 'Farben nur aus dem Register',
    href: '/x',
    keywords: 'd-002',
  },
  {
    group: 'elsewhere',
    key: 'elsewhere:boundless:token:color.ring',
    label: 'color.ring',
    detail: 'boundlessfi/boundless',
    href: '/p/boundless/register?tab=tokens&token=color.ring',
    mono: true,
  },
  {
    group: 'elsewhere',
    key: 'elsewhere:boundless:token:radius.card',
    label: 'radius.card',
    detail: 'boundlessfi/boundless',
    href: '/p/boundless/register?tab=tokens&token=radius.card',
    mono: true,
  },
  { group: 'projects', key: 'project:acme', label: 'acme/shop', href: '/p/acme' },
]

describe('command palette search', () => {
  it('starts with pages, open proposals and projects when nothing is typed', () => {
    const groups = searchPalette(items, '').map((s) => s.group)
    expect(groups).toEqual(['pages', 'proposals', 'projects'])
  })

  it('finds tokens by name, value and CSS variable, best match first', () => {
    const tokens = (q: string) => searchPalette(items, q).find((s) => s.group === 'tokens')?.items ?? []
    expect(tokens('primary').map((i) => i.label)).toEqual(['color.primary'])
    expect(tokens('#3c6681').map((i) => i.label)).toEqual(['color.primary'])
    expect(tokens('--color-secondary').map((i) => i.label)).toEqual(['color.secondary'])
    expect(tokens('radius').map((i) => i.label)).toEqual(['radius.card'])
  })

  it('needs every word to match and ranks exact and prefix matches first', () => {
    expect(rankOf(items[6] as PaletteItem, 'button')).toBe(0)
    expect(rankOf(items[6] as PaletteItem, 'but')).toBe(1)
    expect(rankOf(items[7] as PaletteItem, 'farben register')).toBe(2)
    expect(rankOf(items[6] as PaletteItem, 'button card')).toBeUndefined()
  })

  it('returns nothing for a query nothing matches', () => {
    expect(searchPalette(items, 'zzz')).toEqual([])
  })

  it('finds a rule by its name and, in the details, by its code', () => {
    const rules = (q: string) => searchPalette(items, q).find((s) => s.group === 'decisions')?.items ?? []
    expect(rules('farben').map((i) => i.label)).toEqual(['Farben nur aus dem Register'])
    expect(rules('d-002').map((i) => i.label)).toEqual(['Farben nur aus dem Register'])
  })

  it('looks in the other projects only when the current one has nothing for the query', () => {
    const groups = (q: string) => searchPalette(items, q).map((s) => s.group)
    expect(groups('ring')).toEqual(['elsewhere'])
    expect(groups('radius')).not.toContain('elsewhere')
    expect(groups('')).not.toContain('elsewhere')
    const hit = searchPalette(items, 'ring')[0]?.items[0]
    expect(hit?.detail).toBe('boundlessfi/boundless')
    expect(hit?.href).toContain('/p/boundless/')
  })

  it('links every hit to an existing deep link', () => {
    const hit = searchPalette(items, 'radius.card')
    expect(hit.map((s) => s.group)).toEqual(['proposals', 'tokens'])
    expect(hit[1]?.items[0]?.href).toContain('token=radius.card')
  })
})
