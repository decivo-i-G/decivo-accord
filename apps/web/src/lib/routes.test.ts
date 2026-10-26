import { describe, expect, it } from 'vitest'
import {
  DECISION_SOURCES,
  decisionHref,
  decisionSourceOf,
  decisionsHref,
  LEGACY_REDIRECTS,
  projectHref,
  SECTIONS,
  withDecision,
} from './routes'

describe('routes', () => {
  it('has three sections, the overview first, and keeps the settings out of them', () => {
    expect(SECTIONS).toEqual(['overview', 'decisions', 'register'])
    expect(SECTIONS).not.toContain('connections')
  })

  it('makes the project start the overview', () => {
    expect(projectHref('acme')).toBe('/p/acme')
    expect(projectHref('acme', 'overview')).toBe('/p/acme')
    expect(projectHref('acme', 'decisions')).toBe('/p/acme/decisions')
    expect(projectHref('acme', 'connections')).toBe('/p/acme/connections')
    expect(decisionHref('acme', 'code:src/a.tsx')).toBe('/p/acme/decisions?id=code%3Asrc%2Fa.tsx')
  })

  it('filters the inbox by the surface a decision comes from, and keeps the filter on a decision', () => {
    expect(DECISION_SOURCES).toEqual(['code', 'figma', 'pen', 'claude-design'])
    expect(decisionsHref('acme')).toBe('/p/acme/decisions')
    expect(decisionsHref('acme', 'figma')).toBe('/p/acme/decisions?source=figma')
    expect(withDecision(decisionsHref('acme', 'pen'), 'P-1')).toBe('/p/acme/decisions?source=pen&id=P-1')
    expect(withDecision(decisionsHref('acme'), 'code:src/a.tsx')).toBe(decisionHref('acme', 'code:src/a.tsx'))
  })

  it('reads ?source= only when it names a surface; anything else shows every decision', () => {
    for (const s of DECISION_SOURCES) expect(decisionSourceOf(s)).toBe(s)
    // Pencil is `pen` in code and in the address; Claude Design keeps its hyphen.
    for (const s of ['pencil', 'claude_design', 'Figma', '', undefined, ['figma']])
      expect(decisionSourceOf(s)).toBeUndefined()
  })

  it('sends the old addresses to the new sections', () => {
    const to = Object.fromEntries(LEGACY_REDIRECTS.map((r) => [r.source, r.destination]))
    expect(to['/p/:project/health']).toBe('/p/:project')
    expect(to['/p/:project/proposals']).toBe('/p/:project/decisions')
    // The gear's "Projekteinstellungen" has an address of its own too.
    expect(to['/p/:project/settings']).toBe('/p/:project/connections')
    // Next carries the query string over unless the destination sets its own: none of them does.
    for (const r of LEGACY_REDIRECTS) expect(r.destination).not.toContain('?')
  })
})
