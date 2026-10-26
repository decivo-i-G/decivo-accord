import { createTranslator } from 'next-intl'
import { describe, expect, it } from 'vitest'
import de from '../../messages/de.json'
import en from '../../messages/en.json'
import { pageTitle, proposalItemTitle } from './page-title'
import type { Message, ProposalView } from './proposals'

const proposals: Pick<ProposalView, 'id' | 'title'>[] = [
  { id: 'P-20261013-figma-blue', title: { key: 'title.change', values: { token: 'color.blue.600' } } },
  { id: 'P-20261014-pen-radius', title: { key: 'title.change', values: { token: 'radius.card' } } },
  { id: 'P-20261015-handoff', title: { key: 'title.handoff', values: { name: 'Landing' } } },
]

describe('page titles', () => {
  for (const [locale, messages] of [
    ['de', de],
    ['en', en],
  ] as const) {
    const t = createTranslator({ locale, messages, namespace: 'proposals' })
    const say = (m: Message) =>
      (t as unknown as (k: string, v?: Record<string, string | number>) => string)(m.key, m.values)
    const nav = createTranslator({ locale, messages, namespace: 'nav' })
    const titleFor = (id: string | undefined) =>
      pageTitle([proposalItemTitle(proposals, id, say), nav('decisions'), 'acme/shop'])

    it(`gives every selected proposal its own title (${locale})`, () => {
      const a = titleFor('P-20261013-figma-blue')
      const b = titleFor('P-20261014-pen-radius')
      expect(a).not.toBe(b)
      expect(a).toContain('color.blue.600')
      expect(a.endsWith(`${nav('decisions')} · acme/shop`)).toBe(true)
    })

    it(`falls back to the section without a (known) selection (${locale})`, () => {
      expect(titleFor(undefined)).toBe(`${nav('decisions')} · acme/shop`)
      expect(titleFor('P-unknown')).toBe(`${nav('decisions')} · acme/shop`)
    })
  }

  it('orders item, section, project and drops empty parts', () => {
    expect(pageTitle(['D-002', 'Register', 'acme/shop'])).toBe('D-002 · Register · acme/shop')
    expect(pageTitle([undefined, ' ', 'Register', false, 'acme/shop'])).toBe('Register · acme/shop')
  })
})
