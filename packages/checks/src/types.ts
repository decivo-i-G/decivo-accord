import type {
  ColorValue,
  DimensionValue,
  DriftItem,
  Owner,
  OwnerSource,
  Register,
  SurfaceId,
} from '@decivo/accord-core'

/**
 * How a change arrived:
 * - `proposal`: someone proposed it on purpose (Claude Design handoff, pull request, review page).
 * - `drift`: found by comparing a surface with the register; nobody proposed it. The register wins.
 */
export type Intent = 'proposal' | 'drift'

/** A literal value used in code or in a draft, e.g. a hard-coded colour in a component. */
export interface LiteralUse {
  file: string
  line: number
  column: number
  raw: string
  kind: 'color' | 'dimension'
  value: ColorValue | DimensionValue
  /** Token with exactly this value, if any. */
  replacement?: string | undefined
  /** Closest token if no exact one exists. */
  near?: { path: string; distance: number } | undefined
  /** The value is covered by a justified allow rule. */
  allowed?: string | undefined
  /** The file renders without CSS variables (e-mail, PDF, OG image). */
  inlineOnly?: boolean | undefined
}

/** Everything one evaluation looks at. */
export interface ChangeSet {
  source: SurfaceId
  intent: Intent
  /** Register-level differences (from the three-way diff). */
  items: DriftItem[]
  /** Literal values in the touched files or the draft. */
  literals: LiteralUse[]
}

export interface ChangeState {
  register: Register
  change: ChangeSet
}

// --- Provider interface (principle 6: model-agnostic) ---

export type QuestionKind = 'yes_no' | 'choice' | 'number' | 'text'

export interface TypedQuestion {
  id: string
  kind: QuestionKind
  text: string
  options?: string[] | undefined
  /** Decision the question belongs to, so the answer can be shown with its `why`. */
  decisionId?: string | undefined
  /** Register path the question is about. */
  path?: string | undefined
}

export interface Answer {
  questionId: string
  answer: boolean | string | number
  /** Confidence in [0, 1]. Deterministic answers are 1. */
  p: number
  provider: string
  /** Set when `p` comes from per-customer calibration, not the provider's raw estimate. */
  calibrated?: boolean | undefined
}

export interface CheckProvider {
  id: string
  ask(state: ChangeState, questions: TypedQuestion[]): Promise<Answer[]>
}

// --- Results ---

/** What kind of change an item is, as shown in the "Art" row. */
export type ChangeCategory =
  | 'token_value'
  | 'new_token'
  | 'token_removed'
  | 'token_renamed'
  | 'token_type'
  | 'token_deprecation'
  | 'variant'
  | 'prop'
  | 'state'
  | 'slot'
  | 'new_component'
  | 'component_removed'

export interface Violation {
  decisionId: string
  level: 'must' | 'should'
  rule: string
  why: string
  fixHint?: string | undefined
  /** Register path or `file:line:column`. */
  at: string
  /** Machine-readable reason, rendered by the UI in its language. */
  code: 'outside_scale' | 'raw_value' | 'low_contrast' | 'model'
  detail: Record<string, string | number>
  /** Suggested replacement token, if one exists. */
  replacement?: string | undefined
  p: number
}

export interface ItemEvaluation {
  item: DriftItem
  category: ChangeCategory
  owner: Owner
  ownerSource: OwnerSource
  /** True when the surface the change came from is the owner of what it changed. */
  ownerAllowed: boolean
  answers: Answer[]
  violations: Violation[]
}

export type Route = 'auto' | 'reset' | 'explain' | 'owner'

export type RouteReasonCode =
  | 'breaking'
  | 'deletion'
  | 'conflict'
  | 'must_violation'
  | 'not_owner'
  | 'register_owned'
  | 'drift_reset'
  | 'drift_addition'
  | 'low_confidence'
  | 'unanswered'
  | 'should_violation'
  | 'safe'
  | 'nothing_to_do'

export interface RouteReason {
  code: RouteReasonCode
  /** Register path or file location the reason is about. */
  at?: string | undefined
  detail?: Record<string, string | number> | undefined
}

export type Risk = 'low' | 'medium' | 'high'

/**
 * A hint that never changes the route (F15): a colour that has no value of its own in a context and shows its
 * default (light) value there, e.g. a new colour without a dark value or a dark value that is removed.
 */
export interface ContextWarning {
  code: 'context_fallback'
  /** Register path, e.g. `tokens.color.surface`. */
  at: string
  /** The context that falls back, e.g. `{ theme: 'dark' }`. */
  context: Record<string, string>
}

export interface Evaluation {
  route: Route
  /** Every reason that applies, strongest first. The first one decides the route. */
  reasons: RouteReason[]
  risk: Risk
  /** Lowest confidence among the answers the route depends on. */
  confidence: number
  /** Who decides when a human is needed. */
  decider?: Owner | undefined
  items: ItemEvaluation[]
  /** Violations from literal values (hard-coded colours in code or drafts). */
  literalViolations: Violation[]
  /** Model questions that were asked, for audit and calibration. */
  questions: TypedQuestion[]
  /** Hints that do not change the route (colours that fall back to the default in a context, F15). */
  warnings?: ContextWarning[] | undefined
}
