import { buildRegister, classify, cssToColor } from '@decivo/accord-core'
import { describe, expect, it } from 'vitest'
import { evaluate } from '../evaluate.js'
import type { ChangeState, TypedQuestion } from '../types.js'
import { aggregate, createAnthropicProvider, type MessagesClient } from './anthropic.js'

const register = buildRegister([
  {
    path: 'accord.config.yaml',
    content: 'version: 1\nownership:\n  rules:\n    - { match: tokens.color.**, owner: design }\n',
  },
  {
    path: 'tokens/c.tokens.json',
    content: JSON.stringify({ color: { $type: 'color', ink: { $value: cssToColor('#16222b') } } }),
  },
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
`,
  },
])

const op = {
  kind: 'token.value_changed' as const,
  path: 'tokens.color.ink',
  type: 'color' as const,
  before: cssToColor('#16222b'),
  after: cssToColor('#ff00aa'),
}
const state: ChangeState = {
  register,
  change: {
    source: 'claude-design',
    intent: 'proposal',
    items: [{ op, origin: 'surface', classification: classify(op) }],
    literals: [],
  },
}

type Reply =
  | { answers: { id: string; answer: string; confidence: number; reason: string }[] }
  | 'refusal'
  | 'error'

/** Fake client: returns the queued replies in order and records the requests. */
function fakeClient(replies: Reply[]) {
  const requests: Record<string, unknown>[] = []
  const client = {
    messages: {
      parse: async (params: Record<string, unknown>) => {
        requests.push(params)
        const reply = replies.shift()
        if (reply === 'error' || reply === undefined) throw new Error('boom')
        if (reply === 'refusal') return { stop_reason: 'refusal', parsed_output: null }
        return { stop_reason: 'end_turn', parsed_output: reply }
      },
    },
  } as unknown as MessagesClient
  return { client, requests }
}

const QUESTION_ID = 'D-020#0@tokens.color.ink'
const yes = (confidence: number) => ({
  answers: [{ id: QUESTION_ID, answer: 'yes', confidence, reason: 'Pink is new.' }],
})
const no = (confidence: number) => ({
  answers: [{ id: QUESTION_ID, answer: 'no', confidence, reason: 'Same family.' }],
})

describe('Anthropic provider', () => {
  it('asks Haiku with structured output, low effort and the decisions in a cached system block', async () => {
    const { client, requests } = fakeClient([yes(0.9), yes(0.9), yes(0.9)])
    const provider = createAnthropicProvider({ client, model: 'claude-haiku-5-5' })
    const answers = await provider.ask(state, [
      {
        id: QUESTION_ID,
        kind: 'yes_no',
        text: 'Does the change introduce a new colour family?',
        decisionId: 'D-020',
        path: 'tokens.color.ink',
      },
    ])
    expect(answers).toEqual([
      { questionId: QUESTION_ID, answer: true, p: 0.9, provider: 'anthropic:claude-haiku-5-5' },
    ])
    expect(requests).toHaveLength(3)
    const request = requests[0] as {
      model: string
      output_config: { effort: string; format: unknown }
      system: { text: string; cache_control?: unknown }[]
      messages: { content: string }[]
    }
    expect(request.model).toBe('claude-haiku-5-5')
    expect(request.output_config.effort).toBe('low')
    expect(request.output_config.format).toBeDefined()
    expect(request.system[1]?.text).toContain('Weniger ist mehr.')
    expect(request.system[1]?.cache_control).toEqual({ type: 'ephemeral' })
    expect(request.messages[0]?.content).toContain('<change>')
  })

  it('lowers p when samples disagree, refuse or fail', async () => {
    const { client } = fakeClient([yes(0.9), no(0.8), 'refusal'])
    const answers = await createAnthropicProvider({ client }).ask(state, [
      { id: QUESTION_ID, kind: 'yes_no', text: 'q' },
    ])
    expect(answers[0]?.p).toBe(0.3) // 1 of 3 samples agree, confidence 0.9
  })

  it('returns no answer when every sample fails, so a human decides', async () => {
    const { client } = fakeClient(['error', 'error', 'error'])
    const provider = createAnthropicProvider({ client })
    expect(await provider.ask(state, [{ id: QUESTION_ID, kind: 'yes_no', text: 'q' }])).toEqual([])
    const result = await evaluate(state, { providers: [provider] })
    expect(result.route).toBe('explain')
    expect(result.reasons[0]?.code).toBe('unanswered')
  })

  it('blocks through the evaluation when the model agrees on yes', async () => {
    const { client } = fakeClient([yes(0.95), yes(0.95), yes(0.95)])
    const result = await evaluate(state, { providers: [createAnthropicProvider({ client })] })
    expect(result.route).toBe('owner')
    expect(result.items[0]?.violations[0]).toMatchObject({ decisionId: 'D-020', code: 'model', p: 0.95 })
  })
})

describe('aggregate', () => {
  const q = (kind: TypedQuestion['kind'], options?: string[]): TypedQuestion => ({
    id: 'q',
    kind,
    text: 't',
    options,
  })
  const sample = (answer: string, confidence = 1) => ({
    answers: [{ id: 'q', answer, confidence, reason: '' }],
  })

  it('normalises answers per kind and drops unusable ones', () => {
    expect(
      aggregate([q('choice', ['token_value', 'new_token'])], [sample('New_Token')], 'm')[0]?.answer,
    ).toBe('new_token')
    expect(aggregate([q('choice', ['a'])], [sample('b')], 'm')).toEqual([])
    expect(aggregate([q('number')], [sample('42')], 'm')[0]?.answer).toBe(42)
    expect(aggregate([q('yes_no')], [sample('maybe')], 'm')).toEqual([])
  })

  it('clamps stated confidence', () => {
    expect(aggregate([q('yes_no')], [sample('yes', 7)], 'm')[0]?.p).toBe(1)
  })
})
