import {
  buildRegister,
  type ChangeOp,
  classify,
  cssToColor,
  type DriftItem,
  type RegisterFile,
  resolveOwner,
} from '@decivo/accord-core'
import { describe, expect, it } from 'vitest'
import { evaluate } from './evaluate.js'
import { auditContrast, contextFallbacks } from './rules.js'

const color = (hex: string) => ({ $value: cssToColor(hex) })

/** A shadcn-like register with light and dark, and the contrast rules of the decivo style. */
const files = (dark: Record<string, unknown> = {}): RegisterFile[] => [
  {
    path: 'accord.config.yaml',
    content:
      'version: 1\nownership:\n  default: register\n  rules:\n    - { match: tokens.color.**, owner: design }\n',
  },
  {
    path: 'tokens/color.tokens.json',
    content: JSON.stringify({
      color: {
        $type: 'color',
        neutral: { '50': color('#fafafa'), '900': color('#171717'), '950': color('#0a0a0a') },
        surface: color('#ffffff'),
        text: color('#171717'),
        accent: color('#2563eb'),
        brand: { $value: '{color.neutral.900}' },
      },
    }),
  },
  {
    path: 'modes/theme/dark.tokens.json',
    content: JSON.stringify({
      color: {
        surface: { $value: '{color.neutral.950}' },
        text: { $value: '{color.neutral.50}' },
        brand: { $value: '{color.neutral.50}' },
        ...dark,
      },
    }),
  },
  {
    path: 'resolver.json',
    content: JSON.stringify({
      version: '2025.10',
      sets: { core: { sources: [{ $ref: 'tokens/color.tokens.json' }] } },
      modifiers: {
        theme: {
          contexts: { light: [], dark: [{ $ref: 'modes/theme/dark.tokens.json' }] },
          default: 'light',
        },
      },
      resolutionOrder: [{ $ref: '#/sets/core' }, { $ref: '#/modifiers/theme' }],
    }),
  },
  {
    path: 'decisions/D-002.yaml',
    content:
      'id: D-002\nrule: Colours only from the register\nwhy: Every new colour is a decision.\nscope: [tokens.color.**]\nlevel: must\nowner: design\nchecks:\n  - type: deterministic\n    rule: { kind: value_in_scale, scale: tokens.color.** }\n',
  },
  {
    path: 'decisions/D-003.yaml',
    content:
      'id: D-003\nrule: Body text reaches 4.5:1 on surfaces\nwhy: Readable for everyone, in light and dark.\nscope: [tokens.color.text, tokens.color.surface]\nlevel: must\nowner: design\nchecks:\n  - type: deterministic\n    rule: { kind: min_contrast, ratio: 4.5, foreground: tokens.color.text, background: tokens.color.surface }\n',
  },
  {
    path: 'decisions/D-005.yaml',
    content:
      'id: D-005\nrule: Large text and UI parts reach 3:1 on surfaces\nwhy: Controls must be visible.\nscope: [tokens.color.accent, tokens.color.surface]\nlevel: must\nowner: design\nchecks:\n  - type: deterministic\n    rule: { kind: min_contrast, ratio: 3, foreground: tokens.color.accent, background: tokens.color.surface }\n',
  },
]

const item = (op: ChangeOp): DriftItem => ({ op, origin: 'surface', classification: classify(op) })
const dark = { theme: 'dark' }
const change = (path: string, before: string, after: string, context?: Record<string, string>): ChangeOp => ({
  kind: 'token.value_changed',
  path,
  type: 'color',
  before: cssToColor(before),
  after: cssToColor(after),
  ...(context ? { context } : {}),
})
const propose = (register: ReturnType<typeof buildRegister>, ...ops: ChangeOp[]) =>
  evaluate({ register, change: { source: 'figma', intent: 'proposal', items: ops.map(item), literals: [] } })

describe('rules per context', () => {
  const register = buildRegister(files())

  it('starts from a valid register with readable contrast in light and dark', () => {
    expect(register.issues).toEqual([])
    expect(auditContrast(register)).toEqual([])
  })

  it('measures a dark value against dark surfaces, and names the context', async () => {
    // Dark text #333333 on the dark surface #0a0a0a: 1.6:1.
    const evaluation = await propose(register, change('tokens.color.text', '#fafafa', '#333333', dark))
    const violations = evaluation.items.flatMap((i) => i.violations)
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decisionId: 'D-003',
          code: 'low_contrast',
          detail: expect.objectContaining({ against: 'color.surface', context: 'dark', required: 4.5 }),
        }),
      ]),
    )
    expect(evaluation.route).toBe('owner')
    expect(evaluation.reasons[0]?.code).toBe('must_violation')
  })

  it('checks a light change in dark too where the token has no dark value of its own (large text/UI 3:1)', async () => {
    // accent has no dark value: a darker accent passes on white but fails on the dark surface.
    const evaluation = await propose(register, change('tokens.color.accent', '#2563eb', '#1e3a8a'))
    const violation = evaluation.items[0]?.violations.find((v) => v.decisionId === 'D-005')
    expect(violation?.detail).toMatchObject({ against: 'color.surface', context: 'dark', required: 3 })
  })

  it('does not measure a light change in dark where dark has its own value', async () => {
    // A light surface change: text is #171717 in light (fine), dark keeps its own surface.
    const evaluation = await propose(register, change('tokens.color.surface', '#ffffff', '#f5f5f5'))
    expect(evaluation.items[0]?.violations.filter((v) => v.code === 'low_contrast')).toEqual([])
  })

  it('counts dark values as register colours for the scale, per context', async () => {
    // #0a0a0a is neutral.950: in the scale.
    const inScale = await propose(register, change('tokens.color.accent', '#2563eb', '#0a0a0a', dark))
    expect(inScale.items[0]?.violations.filter((v) => v.code === 'outside_scale')).toEqual([])
    const outside = await propose(register, change('tokens.color.accent', '#2563eb', '#60a5fa', dark))
    expect(outside.items[0]?.violations.find((v) => v.code === 'outside_scale')?.detail).toMatchObject({
      context: 'dark',
      value: '#60a5fa',
    })
  })

  it('keeps the owner of the path in every context, and lets a safe dark change from design through', async () => {
    expect(
      resolveOwner(
        register,
        'tokens.color.surface',
        classify(change('tokens.color.surface', '#000', '#111', dark)).aspect,
      ).owner,
    ).toBe('design')
    const evaluation = await propose(register, change('tokens.color.surface', '#0a0a0a', '#171717', dark))
    expect(evaluation.items[0]).toMatchObject({ owner: 'design', ownerAllowed: true, violations: [] })
    expect(evaluation.route).toBe('auto')
  })

  it('always sends the removal of a dark value to a person, with the F15 warning', async () => {
    const removal: ChangeOp = {
      ...(change('tokens.color.brand', '#fafafa', '#171717', dark) as ChangeOp & {
        kind: 'token.value_changed'
      }),
      fallback: 'after',
    }
    const evaluation = await propose(register, removal)
    expect(evaluation.route).toBe('owner')
    expect(evaluation.reasons.map((r) => r.code)).toContain('deletion')
    expect(evaluation.warnings).toEqual([
      { code: 'context_fallback', at: 'tokens.color.brand', context: dark },
    ])
  })

  it('warns, never blocks, when a new colour has no dark value (F15)', async () => {
    const added: ChangeOp = {
      kind: 'token.added',
      path: 'tokens.color.muted',
      after: { type: 'color', value: cssToColor('#fafafa') },
    }
    const evaluation = await propose(register, added)
    expect(evaluation.warnings).toEqual([
      { code: 'context_fallback', at: 'tokens.color.muted', context: dark },
    ])
    expect(evaluation.reasons.some((r) => r.code === 'must_violation' && r.at === 'tokens.color.muted')).toBe(
      false,
    )
  })
})

describe('the register in light and dark', () => {
  it('audits contrast in every context: a dark text that is too dark fails in dark only', () => {
    const register = buildRegister(files({ text: color('#262626') }))
    expect(auditContrast(register)).toEqual([
      expect.objectContaining({
        decisionId: 'D-003',
        at: 'tokens.color.text',
        detail: { against: 'color.surface', ratio: 1.31, required: 4.5, context: 'dark' },
      }),
    ])
  })

  it('lists colours that fall back to light in dark, but not the palette (F15)', () => {
    const register = buildRegister(files())
    // accent has no dark value; neutral.* are palette colours other tokens point to.
    expect(contextFallbacks(register)).toEqual([{ path: 'color.accent', context: 'dark' }])
    expect(
      contextFallbacks(
        buildRegister(files().filter((f) => f.path !== 'resolver.json' && !f.path.startsWith('modes/'))),
      ),
    ).toEqual([])
  })
})
