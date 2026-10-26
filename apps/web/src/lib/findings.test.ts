import type { DriftReport } from '@decivo/accord-cli'
import type { DriftItem } from '@decivo/accord-core'
import { createTranslator } from 'next-intl'
import { describe, expect, it } from 'vitest'
import de from '../../messages/de.json'
import en from '../../messages/en.json'
import { type SurfaceHealth, surfaceItems } from './data'
import {
  awaitingCode,
  bandOf,
  buildFindings,
  type Finding,
  findingPoints,
  healthSummary,
  nextAction,
  originCounts,
  type ProposalLike,
  scoreBreakdown,
  surfaceDrift,
} from './findings'
import { taskText } from './overview'
import { surfaceState } from './surface-state'

const hard = (file: string, replacement?: string) => ({
  file,
  line: 1,
  column: 1,
  raw: '#487a98',
  kind: 'color' as const,
  context: 'string',
  replacement,
  near: replacement ? undefined : { path: 'color.brand', distance: 1.2 },
})

const report = {
  generatedAt: '2026-10-12T10:00:00Z',
  register: { tokens: 3, components: 1, decisions: 1, issues: [] },
  health: { score: 72, preliminary: true, parts: { tokenSync: 0.9, hardValues: 0.5 } },
  code: {
    tokensCovered: 3,
    tokensInSync: 2,
    drift: [
      {
        path: 'tokens.color.border',
        kind: 'token.value_changed',
        origin: 'unknown',
        owner: 'design',
        breaking: false,
        reason: 'value changed',
        register: '#000000',
        surface: '#000000 / 10%',
      },
      {
        path: 'tokens.spacing.lg',
        kind: 'token.type_changed',
        origin: 'unknown',
        owner: 'design',
        breaking: true,
        reason: 'type changed',
      },
    ],
    missing: ['color.phase.new'],
    unreadable: [],
    unmapped: [{ name: '--coral', value: '#d98b6a', candidates: [] }],
    hardValues: [
      hard('src/a.tsx', 'color.brand'),
      hard('src/b.tsx'),
      hard('src/b.tsx'),
      hard('src/a.tsx', 'color.brand'),
      hard('src/a.tsx'),
    ],
    hardValueSummary: { total: 5, exact: 2, near: 3, none: 0, files: 2 },
    inlineOnly: { total: 0, files: [] },
    allowed: { total: 0, reasons: [] },
    adoption: { tokenUses: 10, hardColours: 5, rate: 0.67 },
    tokenUsage: { 'color.border': 12 },
    filesScanned: 10,
  },
} as DriftReport

const surface = (over: Partial<SurfaceHealth> & Pick<SurfaceHealth, 'id'>): SurfaceHealth => ({
  enabled: true,
  files: ['figma/variables.json'],
  compared: 8,
  inSync: 7,
  items: [],
  unmapped: [],
  literals: 0,
  errors: [],
  modes: [],
  ...over,
})

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

const figma = surface({
  id: 'figma',
  items: [
    { token: 'spacing.4', origin: 'deleted', breaking: true, before: '16px' },
    { token: 'blue.700', origin: 'tool', breaking: false, before: '#000', after: '#111' },
    { token: 'radius.card', origin: 'register', breaking: false },
  ],
  unmapped: ['Brand / Accent'],
})

const proposals: ProposalLike[] = [
  proposal({
    id: 'P-del',
    tool: 'figma',
    risk: { deletion: true, breaking: true, conflict: false },
    changes: [
      { token: 'spacing.4', kind: 'remove', type: 'dimension', owner: 'register', origin: 'surface' },
    ],
    title: { key: 'title.remove', values: { token: 'spacing.4' } },
    summary: { key: 'summary.remove', values: { before: '16px' } },
  }),
  proposal({ id: 'P-auto', tool: 'figma', group: 'auto' }),
  proposal({ id: 'P-done', tool: 'figma', group: 'decided' }),
  proposal({
    id: 'code:src/a.tsx',
    tool: 'code',
    kind: 'code',
    title: { key: 'title.code', values: { file: 'src/a.tsx' } },
    summary: { key: 'summary.code', values: { count: 3, tokens: 'color.brand' } },
  }),
]

describe('buildFindings', () => {
  const findings = buildFindings({ report, surfaces: { figma }, proposals })

  it('ranks by severity, then by impact', () => {
    expect(findings.map((f) => `${f.severity} ${f.id} ${f.impact}`)).toEqual([
      'high proposal:P-del 1',
      'high drift:tokens.spacing.lg 1',
      'medium drift:tokens.color.border 12',
      'medium hard:src/a.tsx 3',
      'medium hard:src/b.tsx 2',
      'medium figma:tool 1',
      'low proposal:P-auto 1',
      'low figma:register 1',
      'low figma:unmapped 1',
      'low unmapped 1',
      'low missing 1',
    ])
  })

  it('leaves out what an open proposal already covers and what is decided', () => {
    const ids = findings.map((f) => f.id)
    expect(ids).not.toContain('figma:deleted')
    expect(ids).not.toContain('proposal:P-done')
    // Hard values in code show once, per file, with the derived proposal as their action.
    expect(ids).not.toContain('proposal:code:src/a.tsx')
  })

  it('gives every finding exactly one action', () => {
    const byId = new Map(findings.map((f) => [f.id, f]))
    expect(byId.get('proposal:P-del')?.action).toEqual({ kind: 'proposal', id: 'P-del' })
    expect(byId.get('hard:src/a.tsx')?.action).toEqual({ kind: 'proposal', id: 'code:src/a.tsx' })
    expect(byId.get('hard:src/b.tsx')?.action).toEqual({ kind: 'command', command: 'accord check src/b.tsx' })
    expect(byId.get('figma:tool')?.action).toEqual({
      kind: 'command',
      command: 'accord figma propose --write',
    })
    expect(byId.get('figma:register')?.action).toEqual({ kind: 'command', command: 'accord figma status' })
    expect(byId.get('missing')?.action).toEqual({ kind: 'link', to: 'register' })
  })

  it('carries what the row needs to say', () => {
    const border = findings.find((f) => f.id === 'drift:tokens.color.border')
    expect(border).toMatchObject({
      title: { key: 'finding.driftTitle', values: { path: 'color.border' } },
      text: { key: 'finding.driftValues', values: { register: '#000000', code: '#000000 / 10%' } },
    })
    expect(findings.find((f) => f.id === 'hard:src/a.tsx')?.text.values).toEqual({
      exact: 2,
      near: 1,
      replacements: 'color.brand',
    })
  })

  it('uses only message keys that exist in both languages', () => {
    const pen = surface({
      id: 'pen',
      files: ['design.pen'],
      items: [
        { token: 'a', origin: 'both', breaking: false },
        { token: 'b', origin: 'unknown', breaking: false },
      ],
      errors: ['design.pen: broken'],
      literals: 4,
    })
    const all: Finding[] = buildFindings({ report, surfaces: { figma, pen }, proposals })
    const lookup = (messages: object, path: string) =>
      path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], messages)
    for (const messages of [de, en]) {
      for (const f of all) {
        for (const text of [f.title, f.text]) {
          const ns = text.ns === 'proposals' ? messages.proposals : messages.health
          expect(lookup(ns, text.key), `${text.key}`).toBeTypeOf('string')
        }
        expect(lookup(messages.health, `cause.${f.cause}`), f.cause).toBeTypeOf('string')
        expect(lookup(messages.health, `severity.${f.severity}`)).toBeTypeOf('string')
      }
    }
  })
})

describe('nextAction', () => {
  it('sends to the open proposals of the surface first', () => {
    expect(nextAction(figma, proposals)).toEqual({ kind: 'proposals', id: 'P-del', count: 2 })
  })

  it('gives the exact CLI command when the web cannot read the tool', () => {
    expect(nextAction(figma, [])).toEqual({
      kind: 'command',
      reason: 'propose',
      command: 'accord figma propose --write',
    })
    const behind = surface({ id: 'figma', items: [{ token: 'x', origin: 'register', breaking: false }] })
    expect(nextAction(behind, [])).toMatchObject({ reason: 'behind', command: 'accord figma status' })
  })

  it('explains how to start when there are no files, and says when nothing is left', () => {
    expect(nextAction(surface({ id: 'pen', files: [] }), [])).toEqual({
      kind: 'setup',
      command: 'accord pen status',
    })
    expect(nextAction(surface({ id: 'claude-design', files: [] }), [])).toMatchObject({ kind: 'setup' })
    expect(nextAction(surface({ id: 'figma' }), [])).toEqual({ kind: 'done' })
  })

  it('points code to its derived proposals, else to the drift report', () => {
    const code = surface({ id: 'code', files: [] })
    expect(nextAction(code, proposals, report)).toEqual({ kind: 'proposals', id: 'code:src/a.tsx', count: 1 })
    expect(nextAction(code, [], report)).toMatchObject({ kind: 'command', command: 'accord diff' })
  })
})

describe('surfaceItems and originCounts', () => {
  it('names where each difference comes from, deletions first of all', () => {
    const items = surfaceItems([
      {
        op: {
          kind: 'token.removed',
          path: 'tokens.spacing.4',
          before: { type: 'dimension', value: { value: 16, unit: 'px' } },
        },
        origin: 'surface',
        classification: { breaking: true },
      },
      {
        op: {
          kind: 'token.value_changed',
          path: 'tokens.blue.600',
          type: 'color',
          before: { colorSpace: 'srgb', components: [0, 0, 0], hex: '#000000' },
          after: { colorSpace: 'srgb', components: [1, 1, 1], hex: '#ffffff' },
        },
        origin: 'conflict',
        classification: { breaking: false },
      },
    ] as unknown as DriftItem[])
    expect(items).toMatchObject([
      { token: 'spacing.4', origin: 'deleted', breaking: true, before: '16px' },
      { token: 'blue.600', origin: 'both', breaking: false, before: '#000000', after: '#ffffff' },
    ])
    expect(originCounts(items)).toEqual({ tool: 0, register: 0, both: 1, deleted: 1, unknown: 0 })
  })
})

describe('score', () => {
  it('says how many points each part costs and names the band', () => {
    expect(scoreBreakdown(report.health.parts)).toEqual({
      tokenSync: { share: 0.9, lost: 5 },
      hardValues: { share: 0.5, lost: 25 },
    })
    expect([95, 72, 53, 20].map(bandOf)).toEqual(['good', 'fair', 'poor', 'bad'])
  })
})

/** The acme demo after adopting radius.card (12px → 16px from Figma): the hand-written CSS still says 12px. */
const afterAdopt = {
  ...report,
  health: { score: 47, preliminary: true, parts: { tokenSync: 4 / 9, hardValues: 0.5 } },
  code: {
    ...report.code,
    tokensCovered: 9,
    tokensInSync: 4,
    drift: [
      {
        path: 'tokens.radius.card',
        kind: 'token.value_changed',
        origin: 'unknown',
        owner: 'design',
        breaking: false,
        reason: 'value changed',
        register: '16px',
        surface: '12px',
      },
    ],
    hardValues: [hard('src/components/Card.tsx', 'color.brand')],
    filesScanned: 2,
  },
} as DriftReport

const adopted = proposal({
  id: 'P-radius',
  tool: 'figma',
  group: 'decided',
  decision: { option: 'adopt', by: 'Jannis' },
  changes: [
    {
      token: 'radius.card',
      kind: 'change',
      type: 'dimension',
      before: '12px',
      after: '16px',
      owner: 'design',
      origin: 'surface',
    },
  ],
})

describe('deciding is never punished', () => {
  it('knows which code drift only waits for code to follow a decision', () => {
    expect([...awaitingCode(afterAdopt, [adopted])]).toEqual([
      ['radius.card', { proposal: 'P-radius', register: '16px', code: '12px' }],
    ])
    // Rejected, or code changed to something else: a real deviation.
    expect(awaitingCode(afterAdopt, [{ ...adopted, decision: { option: 'reject' } }]).size).toBe(0)
    const elsewhere = { ...adopted, changes: adopted.changes.map((c) => ({ ...c, before: '10px' })) }
    expect(awaitingCode(afterAdopt, [elsewhere]).size).toBe(0)
  })

  it('keeps the score the adoption started from, with the CLI formula', () => {
    const summary = healthSummary(afterAdopt, [adopted])
    expect(summary).toMatchObject({ measurable: true, score: 53, band: 'poor', waiting: 1, inSync: 4 })
    expect(healthSummary(afterAdopt, []).score).toBe(47)
  })

  it('lists the follow-up as a calm task and points the code row to it', () => {
    const findings = buildFindings({ report: afterAdopt, surfaces: {}, proposals: [adopted] })
    const follow = findings.find((f) => f.id === 'follow:tokens.radius.card')
    expect(follow).toMatchObject({ severity: 'low', cause: 'follow', action: { command: 'accord diff' } })
    expect(findings.some((f) => f.id === 'drift:tokens.radius.card')).toBe(false)
    const code = surface({
      id: 'code',
      files: [],
      items: [{ token: 'radius.card', origin: 'unknown', breaking: false }],
    })
    expect(nextAction(code, [adopted], afterAdopt)).toMatchObject({ reason: 'follow' })
    expect(nextAction(code, [], afterAdopt)).toMatchObject({ reason: 'drift' })
  })
})

describe('no code scanned', () => {
  it('is not measurable, whatever the formula says', () => {
    const none = { ...report, code: { ...report.code, filesScanned: 0, hardValues: [] } } as DriftReport
    expect(healthSummary(none, [])).toMatchObject({ measurable: false })
  })
})

describe('surfaceState', () => {
  it('gives one state per surface, the same on every screen', () => {
    expect(surfaceState({ enabled: true, found: 2 })).toEqual({ id: 'connected', tone: 'success' })
    expect(surfaceState({ enabled: true, found: 0 })).toEqual({ id: 'noFiles', tone: 'warning' })
    // Claude Design with handoffs but switched off: found, never "connected".
    expect(surfaceState({ enabled: false, found: 2 })).toEqual({ id: 'foundOff', tone: 'info' })
    expect(surfaceState({ enabled: false, found: 0 })).toEqual({ id: 'off', tone: 'neutral' })
  })
})

describe('finding texts', () => {
  it('format in both languages with the values they carry', () => {
    const behind = surface({
      id: 'figma',
      items: [{ token: 'radius.card', origin: 'register', breaking: false }],
      errors: ['figma/x.json: broken'],
      unmapped: ['Brand / Accent'],
    })
    const pen = surface({
      id: 'pen',
      files: ['design.pen'],
      items: [
        { token: 'a', origin: 'both', breaking: false },
        { token: 'b', origin: 'unknown', breaking: false },
        { token: 'c', origin: 'tool', breaking: false },
        { token: 'd', origin: 'deleted', breaking: true },
      ],
      literals: 2,
    })
    const none = { ...report, code: { ...report.code, filesScanned: 0 } } as DriftReport
    const all = [
      ...buildFindings({ report, surfaces: { figma: behind, pen }, proposals: [] }),
      ...buildFindings({ report: afterAdopt, surfaces: {}, proposals: [adopted] }),
      ...buildFindings({ report: none, surfaces: {}, proposals: [] }),
    ].filter((f) => !f.title.ns)
    expect(all.length).toBeGreaterThan(10)
    for (const [locale, messages] of [
      ['de', de],
      ['en', en],
    ] as const) {
      const errors: string[] = []
      const t = createTranslator({
        locale,
        messages,
        namespace: 'health',
        onError: (e) => errors.push(e.message),
      })
      for (const f of all)
        for (const text of [f.title, f.text]) {
          // Config keys and paths are marked as <mono> (rendered as <code>); markup checks the tags close.
          const out = t.markup(text.key as Parameters<typeof t>[0], {
            ...text.values,
            mono: (chunks) => `<code>${chunks}</code>`,
          })
          expect(out, `${locale} ${text.key}`).not.toContain('{')
        }
      // The overview says the same findings as tasks: a title with a verb and one sentence how.
      const to = createTranslator({
        locale,
        messages,
        namespace: 'overview',
        onError: (e) => errors.push(e.message),
      })
      for (const f of all) {
        const { title, how, values } = taskText(f)
        for (const key of [title, how])
          expect(to(key as Parameters<typeof to>[0], values), `${locale} ${key}`).not.toMatch(/[{}<>]/)
      }
      expect(errors).toEqual([])
    }
  })
})

describe('the headline and the list agree', () => {
  it('knows how many points each task can bring, with the CLI formula', () => {
    const findings = buildFindings({ report, surfaces: { figma }, proposals })
    const points = findingPoints(findings, report, proposals)
    // 5 hard colours in 10 files; src/a.tsx has 3 of them, src/b.tsx 2. Decisions bring none.
    expect(points.get('hard:src/a.tsx')).toBeGreaterThan(points.get('hard:src/b.tsx') ?? 0)
    expect(points.get('hard:src/b.tsx')).toBeGreaterThan(0)
    expect(points.get('drift:tokens.color.border')).toBeGreaterThan(0)
    expect(points.has('proposal:P-del')).toBe(false)
    expect(points.has('figma:tool')).toBe(false)
    // Fixing every hard colour of a file gives exactly what the score loses to them there.
    const none = {
      ...report,
      code: { ...report.code, hardValues: report.code.hardValues.filter((h) => h.file !== 'src/a.tsx') },
    } as DriftReport
    expect(points.get('hard:src/a.tsx')).toBe(
      healthSummary(none, proposals).score - healthSummary(report, proposals).score,
    )
  })

  it('brings no points while no code file is scanned', () => {
    const none = { ...report, code: { ...report.code, filesScanned: 0 } } as DriftReport
    expect(findingPoints(buildFindings({ report: none, surfaces: {}, proposals: [] }), none, []).size).toBe(0)
  })
})

describe('surfaceDrift', () => {
  const tool = surface({
    id: 'figma',
    tokens: [
      'blue.600',
      'blue.700',
      'radius.card',
      'gray.50',
      'gray.900',
      'color.brand',
      'color.surface',
      'color.ink',
    ],
    items: [{ token: 'spacing.4', origin: 'deleted', breaking: true, before: '16px' }],
  })
  const open = [
    proposal({
      id: 'P-del',
      tool: 'figma',
      changes: [
        { token: 'spacing.4', kind: 'remove', type: 'dimension', owner: 'register', origin: 'surface' },
      ],
    }),
    proposal({
      id: 'P-blue',
      tool: 'figma',
      changes: [
        {
          token: 'blue.600',
          kind: 'change',
          type: 'color',
          owner: 'design',
          origin: 'surface',
          before: '#3c6681',
          after: '#2a5d7c',
        },
      ],
    }),
    proposal({
      id: 'P-radius',
      tool: 'figma',
      changes: [
        { token: 'radius.card', kind: 'change', type: 'dimension', owner: 'design', origin: 'conflict' },
      ],
    }),
    proposal({
      id: 'P-done',
      tool: 'figma',
      group: 'decided',
      changes: [{ token: 'gray.50', kind: 'change', type: 'color', owner: 'design', origin: 'surface' }],
    }),
    proposal({
      id: 'P-pen',
      tool: 'pen',
      changes: [{ token: 'gray.900', kind: 'change', type: 'color', owner: 'design', origin: 'surface' }],
    }),
  ]

  it('counts what the open proposals of that tool changed, so the sync line matches the inbox', () => {
    expect(surfaceDrift(tool, open)).toEqual({
      compared: 9,
      inSync: 6,
      counts: { tool: 1, register: 0, both: 1, deleted: 1, unknown: 0 },
    })
  })

  it('says what the file says when nothing is open', () => {
    expect(surfaceDrift(tool, [])).toMatchObject({ compared: 9, inSync: 8, counts: { deleted: 1 } })
  })

  it('leaves code as the drift report counts it', () => {
    const codeSurface = surface({ id: 'code', compared: 9, inSync: 5 })
    expect(surfaceDrift(codeSurface, open)).toMatchObject({ compared: 9, inSync: 5 })
  })
})

describe('no code file scanned', () => {
  it('points to the patterns to edit, not to a command that only checks again', () => {
    const none = { ...report, code: { ...report.code, filesScanned: 0 } } as DriftReport
    const code = surface({
      id: 'code',
      config: { file: '.accord/accord.config.yaml', include: ['src/**/*.{ts,tsx}'] },
    })
    const finding = buildFindings({ report: none, surfaces: { code }, proposals: [] }).find(
      (f) => f.id === 'code:nofiles',
    )
    expect(finding?.action).toEqual({ kind: 'file', path: '.accord/accord.config.yaml' })
    expect(finding?.text.values).toEqual({
      patterns: 'src/**/*.{ts,tsx}',
      file: '.accord/accord.config.yaml',
    })
  })
})
