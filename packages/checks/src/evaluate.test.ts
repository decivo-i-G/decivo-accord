import {
  buildRegister,
  type ChangeOp,
  type ColorValue,
  classify,
  cssToColor,
  type DriftItem,
  type DriftOrigin,
  type RegisterFile,
} from '@decivo/accord-core'
import { describe, expect, it } from 'vitest'
import { evaluate } from './evaluate.js'
import type { Answer, ChangeSet, CheckProvider, LiteralUse } from './types.js'

const c = (hex: string) => cssToColor(hex) as ColorValue

const FILES: RegisterFile[] = [
  {
    path: 'accord.config.yaml',
    content: `version: 1
ownership:
  default: register
  rules:
    - { match: tokens.color.**, owner: design }
    - { match: tokens.spacing.**, owner: design }
    - { match: components.*.props.**, owner: code }
    - { match: components.*.variants.**, owner: design }
`,
  },
  {
    path: 'tokens/all.tokens.json',
    content: JSON.stringify({
      color: {
        $type: 'color',
        brand: { '600': { $value: c('#487a98') }, '700': { $value: c('#3c6681') } },
        text: { primary: { $value: c('#16222b') } },
        surface: { page: { $value: c('#ffffff') } },
      },
      spacing: { $type: 'dimension', lg: { $value: { value: 24, unit: 'px' } } },
    }),
  },
  {
    path: 'components/button.yaml',
    content:
      'name: Button\nvariants: { variant: [primary, ghost] }\nprops: { disabled: { type: boolean } }\n',
  },
  {
    path: 'decisions/D-004.yaml',
    content: `id: D-004
rule: Markenfarben nur aus der brand-Skala
why: Ein konsistentes Blau macht decivo wiedererkennbar.
scope: [tokens.color.brand.**]
level: must
owner: design
checks:
  - type: deterministic
    rule: { kind: value_in_scale, scale: tokens.color.brand.** }
`,
  },
  {
    path: 'decisions/D-007.yaml',
    content: `id: D-007
rule: Keine harten Farbwerte in Komponenten
why: Nur so greifen Änderungen am Register überall.
scope: ['code:src/components/**']
level: must
owner: register
fix_hint: Token verwenden.
checks:
  - type: deterministic
    rule: { kind: no_raw_values, types: [color] }
`,
  },
  {
    path: 'decisions/D-012.yaml',
    content: `id: D-012
rule: Fließtext mit mindestens 4,5:1 Kontrast
why: WCAG AA.
scope: [tokens.color.text.**]
level: should
owner: design
checks:
  - type: deterministic
    rule: { kind: min_contrast, ratio: 4.5, foreground: tokens.color.text.**, background: tokens.color.surface.** }
`,
  },
]

const register = buildRegister(FILES)

const item = (op: ChangeOp, origin: DriftOrigin = 'surface'): DriftItem => ({
  op,
  origin,
  classification: classify(op),
})
const valueChange = (path: string, before: string, after: string): ChangeOp => ({
  kind: 'token.value_changed',
  path,
  type: 'color',
  before: c(before),
  after: c(after),
})
const change = (over: Partial<ChangeSet>): ChangeSet => ({
  source: 'claude-design',
  intent: 'proposal',
  items: [],
  literals: [],
  ...over,
})
const literal = (file: string, raw: string, over: Partial<LiteralUse> = {}): LiteralUse => ({
  file,
  line: 12,
  column: 5,
  raw,
  kind: 'color',
  value: c(raw),
  ...over,
})

describe('register used by these tests', () => {
  it('is valid', () => {
    expect(register.issues).toEqual([])
  })
})

describe('acceptance scenarios', () => {
  it('a Claude Design handoff with a different brand colour goes to the design owner, citing D-004', async () => {
    const result = await evaluate({
      register,
      change: change({ items: [item(valueChange('tokens.color.brand.600', '#487a98', '#4a7d9b'))] }),
    })
    expect(result.route).toBe('owner')
    expect(result.decider).toBe('design')
    expect(result.reasons[0]).toMatchObject({ code: 'must_violation', detail: { decision: 'D-004' } })
    expect(result.items[0]?.violations[0]).toMatchObject({
      decisionId: 'D-004',
      code: 'outside_scale',
      detail: { value: '#4a7d9b' },
      replacement: 'color.brand.700',
    })
    expect(result.risk).toBe('high')
  })

  it('a draft that uses an off-scale colour is flagged with the nearest brand token', async () => {
    const result = await evaluate({
      register,
      change: change({ literals: [literal('handoff/hero.html', '#4a7d9b')] }),
    })
    expect(result.route).toBe('owner')
    expect(result.literalViolations).toMatchObject([{ decisionId: 'D-004', replacement: 'color.brand.600' }])
  })

  it('a spacing value edited in Claude Design without a proposal is reset to the register', async () => {
    const op: ChangeOp = {
      kind: 'token.value_changed',
      path: 'tokens.spacing.lg',
      type: 'dimension',
      before: { value: 24, unit: 'px' },
      after: { value: 28, unit: 'px' },
    }
    const result = await evaluate({ register, change: change({ intent: 'drift', items: [item(op)] }) })
    expect(result.route).toBe('reset')
    expect(result.risk).toBe('low')
  })

  it('a pull request with hard-coded colours in a component fails with a replacement', async () => {
    const result = await evaluate({
      register,
      change: change({
        source: 'code',
        literals: [literal('src/components/Hero.tsx', '#487a98', { replacement: 'color.brand.600' })],
      }),
    })
    expect(result.route).toBe('owner')
    expect(result.decider).toBe('register')
    expect(result.literalViolations).toMatchObject([
      {
        decisionId: 'D-007',
        code: 'raw_value',
        at: 'src/components/Hero.tsx:12:5',
        replacement: 'color.brand.600',
      },
    ])
  })
})

describe('fixed rules (principle 4)', () => {
  it('sends deletions to a human even when the owner proposes them', async () => {
    const op: ChangeOp = {
      kind: 'token.removed',
      path: 'tokens.spacing.lg',
      before: { type: 'dimension', value: { value: 24, unit: 'px' } },
    }
    const result = await evaluate({ register, change: change({ items: [item(op)] }) })
    expect(result.route).toBe('owner')
    expect(result.reasons.map((r) => r.code)).toEqual(['breaking', 'deletion', 'register_owned'])
  })

  it('sends breaking component changes to a human', async () => {
    const op: ChangeOp = {
      kind: 'variant.removed',
      path: 'components.Button.variants.variant',
      option: 'ghost',
    }
    const result = await evaluate({ register, change: change({ items: [item(op)] }) })
    expect(result.route).toBe('owner')
    expect(result.decider).toBe('design')
  })

  it('cannot be relaxed by thresholds', async () => {
    const lenient = buildRegister(
      FILES.map((f) =>
        f.path === 'accord.config.yaml'
          ? { ...f, content: `${f.content}routing:\n  auto_apply: { low: 0, medium: 0 }\n` }
          : f,
      ),
    )
    const op: ChangeOp = {
      kind: 'component.removed',
      path: 'components.Button',
      before: { variants: {}, props: {}, states: [], slots: {} },
    }
    expect((await evaluate({ register: lenient, change: change({ items: [item(op)] }) })).route).toBe('owner')
  })

  it('sends conflicts to a human', async () => {
    const result = await evaluate({
      register,
      change: change({
        intent: 'drift',
        items: [item(valueChange('tokens.color.text.primary', '#16222b', '#111111'), 'conflict')],
      }),
    })
    expect(result.route).toBe('owner')
    expect(result.reasons[0]?.code).toBe('conflict')
  })
})

describe('ownership', () => {
  it('applies a safe change from the owner automatically', async () => {
    const result = await evaluate({
      register,
      change: change({ items: [item(valueChange('tokens.color.text.primary', '#16222b', '#1a2630'))] }),
    })
    expect(result).toMatchObject({ route: 'auto', risk: 'low', confidence: 1, reasons: [{ code: 'safe' }] })
  })

  it('turns a change by the wrong side into a proposal to the owner', async () => {
    const result = await evaluate({
      register,
      change: change({
        source: 'code',
        items: [item(valueChange('tokens.color.text.primary', '#16222b', '#1a2630'))],
      }),
    })
    expect(result).toMatchObject({
      route: 'owner',
      decider: 'design',
      reasons: [{ code: 'not_owner', detail: { owner: 'design' } }],
    })
  })

  it('lets prop changes from code through and stops them from design', async () => {
    const op: ChangeOp = {
      kind: 'prop.added',
      path: 'components.Button.props.size',
      after: { type: 'string', required: false },
    }
    expect((await evaluate({ register, change: change({ source: 'code', items: [item(op)] }) })).route).toBe(
      'auto',
    )
    expect((await evaluate({ register, change: change({ items: [item(op)] }) })).decider).toBe('code')
  })

  it('keeps new tokens with the register (names belong to the register)', async () => {
    const op: ChangeOp = {
      kind: 'token.added',
      path: 'tokens.color.brand.650',
      after: { type: 'color', value: c('#4a7d9b') },
    }
    const result = await evaluate({ register, change: change({ items: [item(op)] }) })
    expect(result.route).toBe('owner')
    expect(result.reasons.map((r) => r.code)).toContain('register_owned')
  })

  it('ignores register-side changes the proposal has not seen', async () => {
    const result = await evaluate({
      register,
      change: change({
        items: [item(valueChange('tokens.color.text.primary', '#16222b', '#000000'), 'register')],
      }),
    })
    expect(result.route).toBe('auto')
  })
})

describe('drift', () => {
  it('asks a human before discarding something the surface added', async () => {
    const op: ChangeOp = { kind: 'variant.added', path: 'components.Button.variants.variant', option: 'link' }
    const result = await evaluate({ register, change: change({ intent: 'drift', items: [item(op)] }) })
    expect(result.route).toBe('owner')
    expect(result.reasons[0]?.code).toBe('drift_addition')
  })
})

describe('literals', () => {
  it('skips allowed values and files without CSS variables', async () => {
    const result = await evaluate({
      register,
      change: change({
        source: 'code',
        literals: [
          literal('src/components/Logo.tsx', '#0acf83', { allowed: 'Figma-Logo' }),
          literal('src/components/og.tsx', '#487a98', { inlineOnly: true }),
          literal('src/lib/data.ts', '#123456'),
        ],
      }),
    })
    expect(result.literalViolations).toEqual([])
    expect(result.route).toBe('auto')
  })
})

describe('nearest token', () => {
  it('ignores tokens with a different opacity', async () => {
    const withScrim = buildRegister(
      FILES.map((f) =>
        f.path === 'tokens/all.tokens.json'
          ? {
              ...f,
              content: JSON.stringify({
                ...JSON.parse(f.content),
                color: {
                  ...JSON.parse(f.content).color,
                  brand: {
                    ...JSON.parse(f.content).color.brand,
                    scrim: { $value: c('rgba(72,122,152,0.32)') },
                  },
                },
              }),
            }
          : f,
      ),
    )
    const result = await evaluate({
      register: withScrim,
      change: change({ literals: [literal('draft.html', '#487b99')] }),
    })
    expect(result.literalViolations[0]?.replacement).toBe('color.brand.600')
  })
})

describe('should rules', () => {
  it('routes a contrast problem to an explained pull request', async () => {
    const result = await evaluate({
      register,
      change: change({ items: [item(valueChange('tokens.color.text.primary', '#16222b', '#9a9a9a'))] }),
    })
    expect(result.route).toBe('explain')
    expect(result.items[0]?.violations[0]).toMatchObject({
      decisionId: 'D-012',
      code: 'low_contrast',
      detail: { against: 'color.surface.page', required: 4.5 },
    })
  })
})

describe('model questions', () => {
  const withQuestion = buildRegister([
    ...FILES,
    {
      path: 'decisions/D-020.yaml',
      content: `id: D-020
rule: Keine neuen Farbfamilien
why: Weniger ist mehr.
scope: [tokens.color.**]
level: must
owner: design
checks:
  - question: Does the change introduce a new colour family?
    type: yes_no
    block_threshold: 0.7
`,
    },
  ])
  const provider = (answer: boolean, p: number): CheckProvider => ({
    id: 'mock',
    ask: async (_state, questions) =>
      questions.map((q): Answer => ({ questionId: q.id, answer, p, provider: 'mock' })),
  })
  const textChange = () =>
    change({ items: [item(valueChange('tokens.color.text.primary', '#16222b', '#1a2630'))] })

  it('blocks when the model says yes above the threshold', async () => {
    const result = await evaluate(
      { register: withQuestion, change: textChange() },
      { providers: [provider(true, 0.9)] },
    )
    expect(result.route).toBe('owner')
    expect(result.items[0]?.violations).toMatchObject([{ decisionId: 'D-020', code: 'model', p: 0.9 }])
    expect(result.questions).toHaveLength(1)
  })

  it('explains instead of applying when the model is unsure', async () => {
    const result = await evaluate(
      { register: withQuestion, change: textChange() },
      { providers: [provider(false, 0.5)] },
    )
    expect(result.route).toBe('explain')
    expect(result.reasons[0]).toMatchObject({
      code: 'low_confidence',
      detail: { confidence: 0.5, threshold: 0.85 },
    })
  })

  it('never applies automatically when no provider can answer', async () => {
    const result = await evaluate({ register: withQuestion, change: textChange() })
    expect(result.route).toBe('explain')
    expect(result.reasons[0]?.code).toBe('unanswered')
  })

  it('applies automatically when the model is confident there is no problem', async () => {
    const result = await evaluate(
      { register: withQuestion, change: textChange() },
      { providers: [provider(false, 0.97)] },
    )
    expect(result.route).toBe('auto')
  })
})

it('has nothing to do for an empty change', async () => {
  expect(await evaluate({ register, change: change({}) })).toMatchObject({
    route: 'auto',
    reasons: [{ code: 'nothing_to_do' }],
  })
})
