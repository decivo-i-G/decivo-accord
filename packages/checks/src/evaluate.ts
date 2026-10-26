import { modeContext, otherContexts, resolveOwner } from '@decivo/accord-core'
import {
  activeDecisions,
  categorize,
  checkItem,
  checkLiteral,
  decisionCovers,
  isAddition,
  surfaceRole,
} from './rules.js'
import type {
  Answer,
  ChangeState,
  CheckProvider,
  ContextWarning,
  Evaluation,
  ItemEvaluation,
  Risk,
  Route,
  RouteReason,
  RouteReasonCode,
  TypedQuestion,
  Violation,
} from './types.js'

const DEFAULT_BLOCK_THRESHOLD = 0.7

/** Route each reason leads to. Earlier entries are stronger. */
const ROUTE_OF: Record<RouteReasonCode, Route> = {
  breaking: 'owner',
  deletion: 'owner',
  conflict: 'owner',
  must_violation: 'owner',
  not_owner: 'owner',
  register_owned: 'owner',
  drift_addition: 'owner',
  should_violation: 'explain',
  unanswered: 'explain',
  low_confidence: 'explain',
  drift_reset: 'reset',
  safe: 'auto',
  nothing_to_do: 'auto',
}
const STRENGTH = Object.keys(ROUTE_OF) as RouteReasonCode[]

export interface EvaluateOptions {
  /** Model providers for questions Accord cannot answer itself. The first one is asked. */
  providers?: CheckProvider[]
}

/** Model questions for every decision check that is not deterministic and covers a changed path. */
function modelQuestions(state: ChangeState): TypedQuestion[] {
  const questions: TypedQuestion[] = []
  for (const decision of activeDecisions(state.register)) {
    decision.checks.forEach((check, index) => {
      if (check.type === 'deterministic') return
      for (const item of state.change.items) {
        if (!decisionCovers(decision, item.op.path)) continue
        questions.push({
          id: `${decision.id}#${check.id ?? index}@${item.op.path}`,
          kind: check.type,
          text: check.question,
          options: check.options,
          decisionId: decision.id,
          path: item.op.path,
        })
      }
    })
  }
  return questions
}

/**
 * Evaluate a change: classify every item, check ownership and decisions, ask a model only where
 * a decision needs one, and route. Fixed rules (principle 4) come first and cannot be configured:
 * breaking changes, deletions, conflicts and `must` violations always go to a human.
 */
export async function evaluate(state: ChangeState, options: EvaluateOptions = {}): Promise<Evaluation> {
  const { register, change } = state
  const role = surfaceRole(change.source)

  // Deterministic part.
  const items: ItemEvaluation[] = change.items.map((item) => {
    const { owner, source: ownerSource } = resolveOwner(register, item.op.path, item.classification.aspect)
    const violations: Violation[] = []
    for (const decision of activeDecisions(register)) {
      if (!decisionCovers(decision, item.op.path)) continue
      for (const check of decision.checks) {
        if (check.type === 'deterministic')
          violations.push(...checkItem(register, decision, check.rule, item.op))
      }
    }
    const answers: Answer[] = [
      {
        questionId: `category@${item.op.path}`,
        answer: categorize(item.op),
        p: 1,
        provider: 'deterministic',
      },
      {
        questionId: `breaking@${item.op.path}`,
        answer: item.classification.breaking,
        p: 1,
        provider: 'deterministic',
      },
    ]
    return {
      item,
      category: categorize(item.op),
      owner,
      ownerSource,
      ownerAllowed: owner !== 'register' && owner === role,
      answers,
      violations,
    }
  })
  const literalViolations = change.literals.flatMap((literal) =>
    checkLiteral(register, literal, change.source),
  )

  // Model part: only for decisions that ask a question Accord cannot answer itself.
  const questions = modelQuestions(state)
  const provider = options.providers?.[0]
  const modelAnswers = provider && questions.length > 0 ? await provider.ask(state, questions) : []
  const unanswered = questions.filter((q) => !modelAnswers.some((a) => a.questionId === q.id))
  for (const answer of modelAnswers) {
    const question = questions.find((q) => q.id === answer.questionId)
    const item = items.find((i) => i.item.op.path === question?.path)
    if (!question || !item) continue
    item.answers.push(answer)
    const decision = question.decisionId ? register.decisions.get(question.decisionId) : undefined
    const check = decision?.checks.find((c, i) => question.id.startsWith(`${decision.id}#${c.id ?? i}@`))
    const threshold =
      check && check.type !== 'deterministic'
        ? (check.block_threshold ?? DEFAULT_BLOCK_THRESHOLD)
        : DEFAULT_BLOCK_THRESHOLD
    if (decision && question.kind === 'yes_no' && answer.answer === true && answer.p >= threshold) {
      item.violations.push({
        decisionId: decision.id,
        level: decision.level,
        rule: decision.rule,
        why: decision.why,
        fixHint: decision.fix_hint,
        at: item.item.op.path,
        code: 'model',
        detail: { question: question.text },
        p: answer.p,
      })
    }
  }

  // Routing.
  const reasons: RouteReason[] = []
  const add = (code: RouteReasonCode, at?: string, detail?: RouteReason['detail']) =>
    reasons.push({ code, at, detail })
  let decider: Evaluation['decider']

  for (const it of items) {
    const at = it.item.op.path
    if (it.item.origin === 'conflict') add('conflict', at)
    if (change.intent === 'drift') {
      // Nobody proposed this, so the register is not going to change: the surface is put back to the register.
      // Breaking or rule checks describe the surface state being discarded and do not apply. Additions on the
      // surface may be work worth keeping, so a human decides whether they become a proposal.
      if (isAddition(it.item.op) && it.item.origin !== 'register') add('drift_addition', at)
      else add('drift_reset', at)
      continue
    }
    // A proposal only changes what its surface changed; register-side changes it has not seen are not part of it.
    if (it.item.origin === 'register') continue
    if (it.item.classification.breaking) add('breaking', at, { reason: it.item.classification.reason })
    if (it.item.classification.deletion) add('deletion', at)
    for (const v of it.violations)
      if (v.level === 'must') add('must_violation', at, { decision: v.decisionId })
    for (const v of it.violations)
      if (v.level === 'should') add('should_violation', at, { decision: v.decisionId })
    if (!it.ownerAllowed)
      add(it.owner === 'register' ? 'register_owned' : 'not_owner', at, { owner: it.owner })
  }
  for (const v of literalViolations)
    add(v.level === 'must' ? 'must_violation' : 'should_violation', v.at, { decision: v.decisionId })
  for (const q of unanswered) add('unanswered', q.path, { question: q.id })

  const answers = items.flatMap((i) => i.answers)
  const confidence = answers.length > 0 ? Math.min(...answers.map((a) => a.p)) : 1

  const highCodes: RouteReasonCode[] = ['breaking', 'deletion', 'conflict', 'must_violation']
  const risk: Risk = reasons.some((r) => highCodes.includes(r.code))
    ? 'high'
    : items.some((i) => isAddition(i.item.op)) || reasons.some((r) => r.code === 'should_violation')
      ? 'medium'
      : 'low'

  if (change.intent === 'proposal' && risk !== 'high' && reasons.every((r) => ROUTE_OF[r.code] === 'auto')) {
    const threshold = register.config.routing.auto_apply[risk]
    if (confidence < threshold) add('low_confidence', undefined, { confidence, threshold })
  }
  if (items.length === 0 && literalViolations.length === 0) add('nothing_to_do')
  else if (reasons.length === 0) add('safe')

  reasons.sort((a, b) => STRENGTH.indexOf(a.code) - STRENGTH.indexOf(b.code))

  // F15: a colour that ends up without a value of its own in a context shows its light value there. Worth a
  // look, never a block: a new colour without a dark value, or a dark value that is removed.
  const warnings: ContextWarning[] = []
  for (const it of items) {
    const op = it.item.op
    if (op.kind === 'token.added' && op.after.type === 'color')
      for (const c of otherContexts(register))
        warnings.push({ code: 'context_fallback', at: op.path, context: modeContext(register, c) })
    if (op.kind === 'token.value_changed' && op.type === 'color' && op.context && op.fallback === 'after')
      warnings.push({ code: 'context_fallback', at: op.path, context: op.context })
  }
  const route = ROUTE_OF[(reasons[0] as RouteReason).code]

  if (route === 'owner') {
    const first = reasons[0] as RouteReason
    const decision =
      typeof first.detail?.decision === 'string' ? register.decisions.get(first.detail.decision) : undefined
    const item = items.find((i) => i.item.op.path === first.at)
    decider = decision?.owner ?? item?.owner ?? 'register'
  }

  return {
    route,
    reasons,
    risk,
    confidence,
    decider,
    items,
    literalViolations,
    questions,
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}
