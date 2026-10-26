import type { DriftReport } from '@decivo/accord-cli'
import { createTranslator } from 'next-intl'
import { describe, expect, it } from 'vitest'
import de from '../../messages/de.json'
import en from '../../messages/en.json'
import type { SurfaceHealth, SurfaceId } from './data'
import type { ProposalLike } from './findings'
import { OVERVIEW_ITEMS, type OverviewInput, overviewOf } from './overview'

const report = (over: Partial<DriftReport['code']> = {}) =>
  ({
    generatedAt: '2026-10-24T10:00:00Z',
    register: { tokens: 3, components: 1, decisions: 1, issues: [] },
    health: { score: 100, preliminary: true, parts: { tokenSync: 1, hardValues: 1 } },
    code: {
      tokensCovered: 3,
      tokensInSync: 3,
      drift: [],
      missing: [],
      unreadable: [],
      unmapped: [],
      hardValues: [],
      hardValueSummary: { total: 0, exact: 0, near: 0, none: 0, files: 0 },
      inlineOnly: { total: 0, files: [] },
      allowed: { total: 0, reasons: [] },
      adoption: { tokenUses: 10, hardColours: 0, rate: 1 },
      tokenUsage: {},
      filesScanned: 4,
      ...over,
    },
  }) as DriftReport

const surface = (id: SurfaceId, over: Partial<SurfaceHealth> = {}): SurfaceHealth => ({
  id,
  enabled: id === 'code',
  files: [],
  compared: 0,
  inSync: 0,
  items: [],
  unmapped: [],
  literals: 0,
  errors: [],
  modes: [],
  ...over,
})

const surfaces = (over: Partial<Record<SurfaceId, Partial<SurfaceHealth>>> = {}) =>
  Object.fromEntries(
    (['code', 'figma', 'pen', 'claude-design'] as const).map((id) => [id, surface(id, over[id])]),
  ) as Record<SurfaceId, SurfaceHealth>

const proposal = (over: Partial<ProposalLike> & Pick<ProposalLike, 'id' | 'tool'>): ProposalLike => ({
  kind: 'surface',
  group: 'needsYou',
  risk: { deletion: false, breaking: false, conflict: false },
  changes: [],
  colors: [],
  title: { key: 'title.change', values: { token: 'blue.600' } },
  summary: { key: 'summary.change', values: { before: '#3c6681', after: '#2a5d7c' } },
  ...over,
})

const figmaOn = { enabled: true, files: ['figma/variables.json'], compared: 3, inSync: 3, tokens: ['a'] }

const input = (over: Partial<OverviewInput> = {}): OverviewInput => ({
  report: report(),
  surfaces: surfaces({ figma: figmaOn }),
  proposals: [],
  ...over,
})

describe('overview: one next step', () => {
  it('opens the inbox at its first open decision, and counts safe ones as open too', () => {
    const o = overviewOf(
      input({
        proposals: [
          proposal({ id: 'P-1', tool: 'figma' }),
          proposal({ id: 'P-2', tool: 'claude-design', group: 'auto' }),
          proposal({ id: 'P-done', tool: 'figma', group: 'decided' }),
        ],
      }),
    )
    expect(o.step).toEqual({ kind: 'decisions', count: 2, id: 'P-1' })
    expect(o.decisions).toBe(2)
    expect(o.headline).toEqual({ kind: 'decisions', decisions: 2 })
    expect(o.files).toBeUndefined()
  })

  it('keeps the sentence to the decisions, and lists code files that wait for tokens as one item', () => {
    const o = overviewOf(
      input({
        report: report({
          hardValues: [
            { file: 'src/Card.tsx', line: 1, column: 1, raw: '#fff', kind: 'color', context: 'string' },
          ],
          hardValueSummary: { total: 1, exact: 0, near: 0, none: 1, files: 1 },
        }),
        proposals: [
          proposal({ id: 'P-1', tool: 'figma' }),
          proposal({ id: 'code:src/Card.tsx', tool: 'code', kind: 'code', group: 'code' }),
        ],
      }),
    )
    // The sentence says only what the primary step opens; the file is an item of its own.
    expect(o.headline).toEqual({ kind: 'decisions', decisions: 1 })
    expect(o.files).toEqual({ count: 1, id: 'code:src/Card.tsx', file: 'src/Card.tsx' })
    // Decisions and the code file itself are never task items as well.
    expect(o.items.some((f) => f.cause === 'proposal' || f.action.kind === 'proposal')).toBe(false)
    expect(o.items.length).toBeLessThanOrEqual(OVERVIEW_ITEMS - 1)
    expect(o.surfaces.find((s) => s.id === 'code')?.status).toEqual({
      kind: 'files',
      count: 1,
      id: 'code:src/Card.tsx',
    })
  })

  it('looks at the code file when nothing is left to decide', () => {
    const o = overviewOf(
      input({ proposals: [proposal({ id: 'code:src/a.tsx', tool: 'code', kind: 'code', group: 'code' })] }),
    )
    expect(o.step).toEqual({ kind: 'review', files: 1, id: 'code:src/a.tsx' })
    expect(o.headline).toEqual({ kind: 'code', files: 1 })
    // The step is that file: no item repeats it.
    expect(o.files).toBeUndefined()
  })

  it('asks to connect code when no code file was scanned, and does not list that as an item too', () => {
    const o = overviewOf(input({ report: report({ filesScanned: 0 }) }))
    expect(o.step).toEqual({ kind: 'connect' })
    expect(o.headline).toEqual({ kind: 'noCode' })
    expect([...o.items, ...o.more].find((f) => f.cause === 'noFiles')).toBeUndefined()
    expect(o.surfaces.find((s) => s.id === 'code')?.status).toEqual({ kind: 'setup', state: 'noFiles' })
  })

  it('makes the first remaining task the step, and shows at most three more', () => {
    const o = overviewOf(
      input({
        report: report({
          missing: ['a', 'b'],
          unmapped: [{ name: '--x', value: '#123456', candidates: [] }],
        }),
        surfaces: surfaces({
          figma: {
            ...figmaOn,
            items: [
              { token: 'a', origin: 'tool', breaking: false },
              { token: 'b', origin: 'deleted', breaking: true },
              { token: 'c', origin: 'register', breaking: false },
            ],
            unmapped: ['Accent'],
          },
        }),
      }),
    )
    expect(o.step.kind).toBe('finding')
    expect(o.headline.kind).toBe('tasks')
    const first = o.step.kind === 'finding' ? o.step.finding : undefined
    expect(first?.severity).toBe('high')
    expect(o.items.length).toBeLessThanOrEqual(OVERVIEW_ITEMS)
    expect(o.items.map((f) => f.id)).not.toContain(first?.id)
    expect(o.more.length).toBeGreaterThan(0)
    expect(o.more.map((f) => f.id)).not.toContain(first?.id)
  })

  it('puts code that follows a decision taken here before the other small things', () => {
    const o = overviewOf(
      input({
        report: report({
          missing: ['a', 'b', 'c', 'd'],
          drift: [
            {
              kind: 'token.value_changed',
              path: 'tokens.radius.card',
              register: '16px',
              surface: '12px',
              breaking: false,
              reason: 'value',
            },
          ] as DriftReport['code']['drift'],
        }),
        surfaces: surfaces({
          figma: { ...figmaOn, items: [{ token: 'c', origin: 'register', breaking: false }] },
        }),
        proposals: [
          proposal({
            id: 'P-r',
            tool: 'figma',
            group: 'decided',
            decision: { option: 'adopt' } as ProposalLike['decision'],
            changes: [
              {
                token: 'radius.card',
                kind: 'change',
                type: 'dimension',
                owner: 'design',
                origin: 'surface',
                before: '12px',
                after: '16px',
              },
            ],
          }),
        ],
      }),
    )
    // The follow-up comes first, ahead of the larger low ones (here it is the step itself).
    const order = [
      o.step.kind === 'finding' ? o.step.finding.cause : o.step.kind,
      ...o.items.map((f) => f.cause),
    ]
    expect(order.indexOf('follow')).toBeLessThan(order.indexOf('missing'))
    expect(order.indexOf('follow')).toBeLessThan(order.indexOf('behind'))
  })

  it('names the tokens to reset in a tool once, deleted and outdated together', () => {
    const o = overviewOf(
      input({
        surfaces: surfaces({
          figma: {
            ...figmaOn,
            items: [
              { token: 'spacing.4', origin: 'deleted', breaking: true },
              { token: 'blue.600', origin: 'register', breaking: false },
            ],
          },
        }),
      }),
    )
    const all = [o.step.kind === 'finding' ? o.step.finding : undefined, ...o.items, ...o.more].filter(
      (f) => f !== undefined,
    )
    const figma = all.filter((f) => f.surface === 'figma')
    expect(figma.map((f) => f.cause)).toEqual(['revert'])
    expect(figma[0]?.tokens).toEqual(['blue.600', 'spacing.4'])
    expect(figma[0]?.title.values).toMatchObject({ count: 2, tokens: 'blue.600, spacing.4', tool: 'figma' })
    // The Figma line counts the same two values.
    expect(o.surfaces.find((s) => s.id === 'figma')?.status).toEqual({ kind: 'differs', count: 2 })
  })

  it('is calm when everything is decided and in sync', () => {
    const o = overviewOf(input())
    expect(o.step).toEqual({ kind: 'done' })
    expect(o.headline).toEqual({ kind: 'done' })
    expect(o.items).toEqual([])
  })
})

describe('overview: one line per surface', () => {
  it('lists Code, Figma, Pencil and Claude Design in that order with their state', () => {
    const o = overviewOf(
      input({
        proposals: [proposal({ id: 'H-1', tool: 'claude-design' }), proposal({ id: 'F-1', tool: 'figma' })],
        surfaces: surfaces({ figma: figmaOn, pen: { files: ['design/app.pen'] } }),
      }),
    )
    expect(o.surfaces.map((s) => s.id)).toEqual(['code', 'figma', 'pen', 'claude-design'])
    const by = Object.fromEntries(o.surfaces.map((s) => [s.id, s.status]))
    expect(by.code).toEqual({ kind: 'inSync' })
    expect(by.figma).toEqual({ kind: 'waiting', count: 1, id: 'F-1' })
    // Found, but the comparison is switched off.
    expect(by.pen).toEqual({ kind: 'setup', state: 'foundOff' })
    // Handoffs connect Claude Design without switching anything on.
    expect(by['claude-design']).toEqual({ kind: 'waiting', count: 1, id: 'H-1' })
  })

  it('says a connected tool differs when it changed without a decision yet', () => {
    const o = overviewOf(
      input({
        surfaces: surfaces({
          figma: { ...figmaOn, items: [{ token: 'a', origin: 'tool', breaking: false }] },
        }),
      }),
    )
    expect(o.surfaces.find((s) => s.id === 'figma')?.status).toEqual({ kind: 'differs', count: 1 })
    expect(o.surfaces.find((s) => s.id === 'pen')?.status).toEqual({ kind: 'setup', state: 'off' })
  })
})

describe('overview: words in both languages', () => {
  const keys = (tree: unknown, path = ''): string[] =>
    tree && typeof tree === 'object'
      ? Object.entries(tree).flatMap(([k, v]) => keys(v, path ? `${path}.${k}` : k))
      : [path]

  it('has the same keys in German and English', () => {
    expect(keys(en.overview)).toEqual(keys(de.overview))
    expect(keys(en.nav)).toEqual(keys(de.nav))
  })

  for (const [locale, messages] of [
    ['de', de],
    ['en', en],
  ] as const) {
    const t = createTranslator({ locale, messages, namespace: 'overview' })
    const tc = createTranslator({ locale, messages, namespace: 'connections' })
    it(`renders every sentence and state (${locale})`, () => {
      for (const decisions of [1, 5]) {
        const sentence = t('headline.decisions', { decisions })
        expect(sentence).not.toMatch(/[{}]/)
        // One message in the sentence: no file path, nothing the primary step does not open.
        expect(sentence).not.toMatch(/\.tsx|\//)
      }
      expect(t('headline.decisions', { decisions: 5 })).toContain('5')
      for (const files of [1, 3]) {
        const state = tc('state.files', { count: files })
        expect(state).toContain(String(files))
        expect(t('headline.code', { state })).toContain(state)
      }
      expect(t('headline.noCode', { state: tc('state.notChecked') })).toContain(tc('state.notChecked'))
      for (const count of [0, 1, 2]) expect(tc('state.differs', { count })).not.toMatch(/[{}]/)
      expect(t('step.decisions', { count: 4 })).toContain('4')
      // The how of every task says what to do, not only what is wrong.
      expect(t('task.how.followText', { register: '16px', code: '12px' })).not.toMatch(/Punkte|points/)
      expect(t('task.how.missingText', { file: 'src/styles.css' })).toContain('src/styles.css')
      expect(t('task.how.missingText', { file: 'none' })).not.toContain('none')
      expect(t('task.title.deleted', { count: 1, tokens: 'spacing.4', tool: 'figma' })).toContain('spacing.4')
      for (const count of [1, 2]) {
        const values = { count, tokens: 'blue.600, spacing.4', tool: 'figma' }
        expect(t('task.title.revert', values)).toContain('blue.600, spacing.4')
        expect(t('task.how.revertText', values)).not.toMatch(/[{}]/)
      }
    })

    it(`uses one name per state on every screen (${locale})`, () => {
      // Überblick, Projekte and Verbindungen say the same thing about code: the connections keys.
      expect(JSON.stringify(messages.overview)).not.toMatch(/"surface"/)
      expect(messages.overview.step).not.toHaveProperty('include')
      expect(messages.overview.step).not.toHaveProperty('connect')
      expect(tc('state.waiting', { count: 3 })).toContain('3')
    })
  }

  it('calls the inbox "Entscheidungen" and the register\'s rules "Regeln"', () => {
    expect(de.nav.decisions).toBe('Entscheidungen')
    expect(en.nav.decisions).toBe('Decisions')
    expect(de.register.tabs.rules).toBe('Regeln')
    expect(en.register.tabs.rules).toBe('Rules')
    expect(de.nav.overview).toBe('Überblick')
    // The old names are gone from the navigation.
    expect(JSON.stringify(de.nav)).not.toMatch(/Vorschl|Systemzustand/)
  })
})
