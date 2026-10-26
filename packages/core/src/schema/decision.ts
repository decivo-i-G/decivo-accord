import { z } from 'zod'
import { OwnerSchema } from './config.js'

/** Checks Accord can answer without a model. */
export const DeterministicRuleSchema = z.discriminatedUnion('kind', [
  z.object({
    /** Colour values must equal a token matched by `scale`, e.g. `tokens.color.brand.**`. */
    kind: z.literal('value_in_scale'),
    scale: z.string().min(1),
  }),
  z.object({
    /** Code must reference tokens instead of literal values of these types. */
    kind: z.literal('no_raw_values'),
    types: z.array(z.enum(['color', 'dimension', 'fontFamily', 'shadow'])).default(['color']),
  }),
  z.object({
    /** Every foreground token must reach `ratio` against every background token. */
    kind: z.literal('min_contrast'),
    ratio: z.number().positive(),
    foreground: z.string().min(1),
    background: z.string().min(1),
  }),
])

const ModelCheckSchema = z.object({
  id: z.string().optional(),
  question: z.string().min(1),
  type: z.enum(['yes_no', 'choice', 'number', 'text']),
  options: z.array(z.string()).optional(),
  /** Confidence above which a "yes" blocks the change. */
  block_threshold: z.number().min(0).max(1).optional(),
})

const DeterministicCheckSchema = z.object({
  id: z.string().optional(),
  question: z.string().optional(),
  type: z.literal('deterministic'),
  rule: DeterministicRuleSchema,
})

export const CheckSchema = z.union([DeterministicCheckSchema, ModelCheckSchema])

/** Register path pattern (`tokens.…`, `components.…`) or a code file glob (`code:src/components/**`). */
const ScopeSchema = z
  .string()
  .regex(
    /^(tokens|components|decisions)(\.|$)|^code:.+/,
    'scope must start with tokens., components., decisions. or code:',
  )

export const DecisionSchema = z.object({
  id: z.string().regex(/^D-\d{3,}$/, 'decision ids look like D-004'),
  rule: z.string().min(1),
  why: z.string().min(1),
  scope: z.array(ScopeSchema).min(1),
  level: z.enum(['must', 'should']),
  owner: OwnerSchema,
  status: z.enum(['active', 'superseded']).default('active'),
  supersedes: z.array(z.string()).optional(),
  examples: z
    .object({
      good: z.array(z.string()).default([]),
      bad: z.array(z.string()).default([]),
    })
    .optional(),
  /** How to fix a violation, shown to people and agents. */
  fix_hint: z.string().optional(),
  checks: z.array(CheckSchema).default([]),
})

export type Decision = z.infer<typeof DecisionSchema>
export type DecisionCheck = z.infer<typeof CheckSchema>
export type DeterministicRule = z.infer<typeof DeterministicRuleSchema>
