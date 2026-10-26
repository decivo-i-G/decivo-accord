import { createTranslator } from 'next-intl'
import { describe, expect, it } from 'vitest'
import de from '../../messages/de.json'
import en from '../../messages/en.json'
import {
  agreementHref,
  agreementOf,
  connectionRow,
  connectionSummary,
  differingTokens,
  isConnected,
} from './connection-rows'

describe('a connection row says one state and at most one next step', () => {
  it('never sends to the inbox: waiting decisions and code files only make the surface connected', () => {
    const figma = connectionRow({
      tool: 'figma',
      enabled: true,
      found: 1,
      line: { id: 'figma', status: { kind: 'waiting', count: 3, id: 'p-1' } },
    })
    expect(figma.state).toEqual({ kind: 'waiting', count: 3, id: 'p-1' })
    expect(figma.next).toBeUndefined()
    expect(isConnected(figma)).toBe(true)
    const code = connectionRow({
      tool: 'code',
      enabled: true,
      found: 12,
      line: { id: 'code', status: { kind: 'files', count: 1, id: 'code:src/Card.tsx' } },
    })
    expect(code.next).toBeUndefined()
    expect(isConnected(code)).toBe(true)
  })

  it('needs no step when the surface is in sync', () => {
    const row = connectionRow({
      tool: 'pen',
      enabled: true,
      found: 2,
      line: { id: 'pen', status: { kind: 'inSync' } },
    })
    expect(row).toEqual({ tool: 'pen', state: { kind: 'inSync' }, next: undefined })
  })

  it('tells how to add a .fig file when Figma has no files', () => {
    const row = connectionRow({
      tool: 'figma',
      enabled: false,
      found: 0,
      line: { id: 'figma', status: { kind: 'setup', state: 'off' } },
    })
    expect(row.state).toEqual({ kind: 'off' })
    expect(row.next).toEqual({ kind: 'addFile' })
  })

  it('points at files outside the paths before asking for new ones', () => {
    const row = connectionRow({
      tool: 'pen',
      enabled: true,
      found: 0,
      outside: 2,
      line: { id: 'pen', status: { kind: 'setup', state: 'noFiles' } },
    })
    expect(row.next).toEqual({ kind: 'outside', count: 2 })
  })

  it('makes the switch the step when files were found but the surface is off', () => {
    const row = connectionRow({
      tool: 'figma',
      enabled: false,
      found: 1,
      line: { id: 'figma', status: { kind: 'setup', state: 'foundOff' } },
    })
    expect(row.next).toEqual({ kind: 'switchOn' })
  })

  it('names the folders when code lives outside the include patterns', () => {
    const missed = { found: ['app', 'components'], include: ['src'] }
    const row = connectionRow({
      tool: 'code',
      enabled: true,
      found: 0,
      missed,
      line: { id: 'code', status: { kind: 'setup', state: 'noFiles' } },
    })
    expect(row.state).toEqual({ kind: 'noFiles' })
    expect(row.next).toEqual({ kind: 'codeOutside', ...missed })
  })

  it('says an unreadable file before anything else about the surface', () => {
    const row = connectionRow({
      tool: 'figma',
      enabled: true,
      found: 1,
      unreadable: true,
      line: { id: 'figma', status: { kind: 'differs', count: 1 } },
    })
    expect(row.state).toEqual({ kind: 'unreadable' })
    expect(row.next).toEqual({ kind: 'reason', reason: 'unreadable' })
  })

  it('gives the reason of a difference, not its command', () => {
    const row = connectionRow({
      tool: 'figma',
      enabled: true,
      found: 1,
      line: { id: 'figma', status: { kind: 'differs', count: 1 } },
      action: { kind: 'command', reason: 'behind', command: 'accord figma status' },
    })
    expect(row.next).toEqual({ kind: 'reason', reason: 'behind' })
  })

  it('asks for a handoff when Claude Design has none, and counts handoffs as connected', () => {
    expect(connectionRow({ tool: 'claude_design', enabled: false, found: 0 }).next).toEqual({
      kind: 'addFile',
    })
    expect(connectionRow({ tool: 'claude_design', enabled: false, found: 2 }).state).toEqual({
      kind: 'inSync',
    })
  })

  it('sums the rows up as connected and not yet, in the order of the rows', () => {
    const rows = [
      connectionRow({
        tool: 'code',
        enabled: true,
        found: 3,
        line: { id: 'code', status: { kind: 'inSync' } },
      }),
      connectionRow({
        tool: 'figma',
        enabled: true,
        found: 1,
        line: { id: 'figma', status: { kind: 'waiting', count: 2, id: 'p-1' } },
      }),
      connectionRow({ tool: 'pen', enabled: false, found: 0 }),
      connectionRow({ tool: 'claude_design', enabled: false, found: 2 }),
    ]
    expect(connectionSummary(rows)).toEqual({
      kind: 'some',
      connected: ['code', 'figma', 'claude_design'],
      missing: ['pen'],
    })
    expect(connectionSummary(rows.filter((r) => r.tool !== 'pen'))).toEqual({ kind: 'all' })
    expect(connectionSummary([rows[2] as (typeof rows)[number]])).toEqual({ kind: 'none' })
  })

  it('does not count code in folders Accord misses, or an unreadable file, as connected', () => {
    const code = connectionRow({
      tool: 'code',
      enabled: true,
      found: 0,
      missed: { found: ['app'], include: ['src'] },
      line: { id: 'code', status: { kind: 'setup', state: 'noFiles' } },
    })
    expect(isConnected(code)).toBe(false)
    expect(isConnected(connectionRow({ tool: 'figma', enabled: true, found: 1, unreadable: true }))).toBe(
      false,
    )
  })

  it('has words for every state and step in German and English', () => {
    const states = ['off', 'foundOff', 'noFiles', 'waiting', 'files', 'differs', 'inSync', 'unreadable']
    const reasons = ['propose', 'behind', 'unreadable', 'drift', 'follow', 'hardValues', 'noFiles']
    for (const m of [de, en]) {
      const c = m.connections as unknown as {
        state: Record<string, unknown>
        reason: Record<string, unknown>
        add: Record<string, unknown>
      }
      for (const s of states) expect(c.state[s], s).toBeTypeOf('string')
      for (const r of reasons) expect(c.reason[r], r).toBeTypeOf('string')
      for (const tool of ['figma', 'pen']) expect(c.add[tool], tool).toBeTypeOf('string')
      expect((m.connections as unknown as { claudeDesign: { step: unknown } }).claudeDesign.step).toBeTypeOf(
        'string',
      )
      expect(c.state.connected).toBeTypeOf('string')
    }
    for (const m of [de, en]) {
      const t = createTranslator({ locale: m === de ? 'de' : 'en', messages: m, namespace: 'connections' })
      expect(t('summary.some', { connected: 'Figma', missing: 'Pencil', count: 1 })).not.toMatch(/[{}]/)
      expect(t('summary.some', { connected: 'Code und Figma', missing: 'Pencil', count: 2 })).not.toMatch(
        /[{}]/,
      )
    }
  })
})

describe('a connected row says whether it matches the register', () => {
  const figma = (status: Parameters<typeof connectionRow>[0]['line']) =>
    connectionRow({ tool: 'figma', enabled: true, found: 1, line: status })

  it('is in sync only when the overview says so', () => {
    expect(agreementOf(figma({ id: 'figma', status: { kind: 'inSync' } }))).toEqual({ kind: 'inSync' })
  })

  it('counts the places Figma differs, from its status and its open decisions, and links the first', () => {
    const row = figma({ id: 'figma', status: { kind: 'waiting', count: 3, id: 'P-1' } })
    const places = differingTokens(
      [{ token: 'spacing.4' }],
      [
        { changes: [{ token: 'tokens.color.brand' }, { token: 'spacing.4' }] },
        { changes: [{ token: 'radius.sm' }] },
      ],
    )
    expect(places).toEqual(['spacing.4', 'color.brand', 'radius.sm'])
    expect(agreementOf(row, places)).toEqual({ kind: 'drift', count: 3, unit: 'places', id: 'P-1' })
  })

  it('has nothing to link when only the status differs, and says files for code, handoffs for Claude Design', () => {
    expect(agreementOf(figma({ id: 'figma', status: { kind: 'differs', count: 2 } }), [])).toEqual({
      kind: 'drift',
      count: 2,
      unit: 'places',
      id: undefined,
    })
    const code = connectionRow({
      tool: 'code',
      enabled: true,
      found: 12,
      line: { id: 'code', status: { kind: 'files', count: 1, id: 'code:a.tsx' } },
    })
    expect(agreementOf(code)).toMatchObject({ unit: 'files', count: 1, id: 'code:a.tsx' })
    const design = connectionRow({
      tool: 'claude_design',
      enabled: false,
      found: 2,
      line: { id: 'claude-design', status: { kind: 'waiting', count: 2, id: 'P-2' } },
    })
    expect(agreementOf(design)).toMatchObject({ unit: 'handoffs', count: 2 })
  })

  it('links a differing surface to the inbox filtered to it, not to its first decision', () => {
    const drift = (id?: string) => ({ kind: 'drift' as const, count: 2, unit: 'places' as const, id })
    expect(agreementHref('acme', 'figma', drift('P-1'))).toBe('/p/acme/decisions?source=figma')
    expect(agreementHref('acme', 'pen', drift('P-2'))).toBe('/p/acme/decisions?source=pen')
    expect(agreementHref('acme', 'code', drift('code:a.tsx'))).toBe('/p/acme/decisions?source=code')
    // Claude Design is `claude_design` on this screen and `claude-design` in the inbox.
    expect(agreementHref('acme', 'claude_design', drift('P-3'))).toBe(
      '/p/acme/decisions?source=claude-design',
    )
    // Nothing open from the surface (only its status differs), in sync, or not connected: no link.
    expect(agreementHref('acme', 'figma', drift())).toBeUndefined()
    expect(agreementHref('acme', 'figma', { kind: 'inSync' })).toBeUndefined()
    expect(agreementHref('acme', 'pen', undefined)).toBeUndefined()
  })

  it('says nothing about the register for a surface that is not connected', () => {
    expect(agreementOf(connectionRow({ tool: 'pen', enabled: false, found: 0 }))).toBeUndefined()
  })

  it('reads as one sentence in German and English', () => {
    const sentences = [de, en].map((m) => {
      const t = createTranslator({ locale: m === de ? 'de' : 'en', messages: m, namespace: 'connections' })
      const sync = t('compare.when.at', { when: m === de ? 'vor 6 Tagen' : '6 days ago' })
      return [
        t('compare.inSync', { sync }),
        t.rich('compare.drift', { unit: 'places', count: 3, sync, link: (c) => c }),
        t.rich('compare.drift', { unit: 'places', count: 0, sync, link: (c) => c }),
        t.rich('compare.drift', { unit: 'files', count: 1, sync, link: (c) => c }),
        t.rich('compare.drift', { unit: 'handoffs', count: 2, sync, link: (c) => c }),
      ].map((x) => (Array.isArray(x) ? x.join('') : String(x)))
    })
    expect(sentences[0]).toEqual([
      'Stimmt mit dem Register überein, zuletzt abgeglichen vor 6 Tagen.',
      'Weicht an 3 Stellen vom Register ab, zuletzt abgeglichen vor 6 Tagen.',
      'Weicht vom Register ab, zuletzt abgeglichen vor 6 Tagen.',
      'Weicht in einer Datei vom Register ab, zuletzt abgeglichen vor 6 Tagen.',
      '2 Handoffs weichen vom Register ab, zuletzt abgeglichen vor 6 Tagen.',
    ])
    expect(sentences[1]).toEqual([
      'Matches the register, last synced 6 days ago.',
      'Differs from the register in 3 places, last synced 6 days ago.',
      'Differs from the register, last synced 6 days ago.',
      'Differs from the register in one file, last synced 6 days ago.',
      '2 handoffs differ from the register, last synced 6 days ago.',
    ])
  })
})
