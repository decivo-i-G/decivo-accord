import {
  type ChangeOp,
  type ColorValue,
  contextLabel,
  contrastRatio,
  type Decision,
  type DeterministicRule,
  deltaE,
  formatValue,
  type ModeContext,
  matchPath,
  modeContext,
  type Owner,
  otherContexts,
  type Register,
  type RegisterModes,
  type SurfaceId,
  type Token,
  tokensDifferingIn,
  tokensInContext,
  valuesEqual,
} from '@decivo/accord-core'
import picomatch from 'picomatch'
import type { ChangeCategory, LiteralUse, Violation } from './types.js'

/** Which owner a surface speaks for. Claude Design, Figma and Pen are design tools. */
export const surfaceRole = (surface: SurfaceId): Owner => (surface === 'code' ? 'code' : 'design')

export function categorize(op: ChangeOp): ChangeCategory {
  switch (op.kind) {
    case 'token.value_changed':
    case 'token.alias_changed':
      return 'token_value'
    case 'token.added':
      return 'new_token'
    case 'token.removed':
      return 'token_removed'
    case 'token.renamed':
      return 'token_renamed'
    case 'token.type_changed':
      return 'token_type'
    case 'token.deprecated_changed':
      return 'token_deprecation'
    case 'component.added':
      return 'new_component'
    case 'component.removed':
      return 'component_removed'
    case 'variant.added':
    case 'variant.removed':
    case 'variant_axis.added':
    case 'variant_axis.removed':
      return 'variant'
    case 'prop.added':
    case 'prop.removed':
    case 'prop.changed':
      return 'prop'
    case 'state.added':
    case 'state.removed':
      return 'state'
    case 'slot.added':
    case 'slot.removed':
    case 'slot.changed':
      return 'slot'
  }
}

/** Categories that add something new to the system rather than changing what exists. */
export const isAddition = (op: ChangeOp) =>
  [
    'token.added',
    'component.added',
    'variant.added',
    'variant_axis.added',
    'prop.added',
    'state.added',
    'slot.added',
  ].includes(op.kind)

export const activeDecisions = (register: Pick<Register, 'decisions'>) =>
  [...register.decisions.values()].filter((d) => d.status === 'active')

/** Register-path scopes of a decision that match `path`. */
export const decisionCovers = (decision: Decision, path: string) =>
  decision.scope.some((scope) => !scope.startsWith('code:') && matchPath(scope, path))

/** Code scopes (`code:<glob>`) of a decision that match a file. */
export function decisionCoversFile(decision: Decision, file: string): boolean {
  const globs = decision.scope.filter((s) => s.startsWith('code:')).map((s) => s.slice(5))
  return globs.length > 0 && picomatch(globs, { dot: true })(file)
}

/** The decision governs colours if one of its register scopes reaches a colour token. */
const governsColors = (decision: Decision, register: Pick<Register, 'tokens'>) =>
  [...register.tokens.values()].some(
    (t) => t.type === 'color' && decisionCovers(decision, `tokens.${t.path}`),
  )

/** A register as the rules read it: tokens and, with light/dark, its contexts. */
export type RuleRegister = Pick<Register, 'tokens'> & { modes?: RegisterModes | undefined }

const colorTokens = (tokens: Iterable<Token>, pattern: string, except?: string) =>
  [...tokens].filter(
    (t) =>
      t.type === 'color' &&
      t.value !== undefined &&
      t.path !== except &&
      matchPath(pattern, `tokens.${t.path}`),
  )

/**
 * Colour tokens a scale pattern matches. In a context, the scale holds the default values and the values of
 * that context: a dark value is as much a register colour as a light one.
 */
function scaleTokens(register: RuleRegister, pattern: string, except?: string, context?: ModeContext) {
  const inContext = context ? tokensInContext(register, context) : register.tokens
  const tokens = colorTokens(register.tokens.values(), pattern, except)
  return inContext === register.tokens
    ? tokens
    : [...tokens, ...colorTokens(inContext.values(), pattern, except)]
}

function nearestInScale(
  register: RuleRegister,
  pattern: string,
  color: ColorValue,
  except?: string,
  context?: ModeContext,
) {
  let best: { path: string; distance: number } | undefined
  for (const t of scaleTokens(register, pattern, except, context)) {
    // A translucent token is no replacement for an opaque colour (and vice versa).
    if (Math.abs(((t.value as ColorValue).alpha ?? 1) - (color.alpha ?? 1)) > 0.005) continue
    const distance = deltaE(t.value as ColorValue, color)
    if (!best || distance < best.distance) best = { path: t.path, distance: Math.round(distance * 100) / 100 }
  }
  return best
}

const violation = (
  decision: Decision,
  at: string,
  code: Violation['code'],
  detail: Violation['detail'],
  replacement?: string,
): Violation => ({
  decisionId: decision.id,
  level: decision.level,
  rule: decision.rule,
  why: decision.why,
  fixHint: decision.fix_hint,
  at,
  code,
  detail,
  replacement,
  p: 1,
})

/** The new colour a change introduces, if any. */
function introducedColor(op: ChangeOp): ColorValue | undefined {
  if (op.kind === 'token.value_changed' && op.type === 'color') return op.after as ColorValue
  if (op.kind === 'token.added' && op.after.type === 'color') return op.after.value as ColorValue
  return undefined
}

/**
 * The contexts a change reaches: its own context, or for a change of the default value the default context
 * and every context where the token has no value of its own (it falls back to the default there).
 */
function reachedContexts(
  register: RuleRegister,
  op: ChangeOp,
  tokenPath: string,
): (ModeContext | undefined)[] {
  if ('context' in op && op.context) return [op.context]
  const fallbacks = otherContexts(register).filter(
    (c) => !tokensDifferingIn(register, c).some((t) => t.path === tokenPath),
  )
  return [undefined, ...fallbacks.map((c) => modeContext(register, c))]
}

/** Run one deterministic rule of `decision` against a register-level change, in every context it reaches. */
export function checkItem(
  register: RuleRegister,
  decision: Decision,
  rule: DeterministicRule,
  op: ChangeOp,
): Violation[] {
  const tokenPath = op.path.startsWith('tokens.') ? op.path.slice('tokens.'.length) : undefined
  const context = 'context' in op ? op.context : undefined
  const where: Record<string, string> = context ? { context: contextLabel(context) } : {}
  if (rule.kind === 'value_in_scale') {
    const color = introducedColor(op)
    if (!color) return []
    // The token itself does not count as its own scale: changing a brand colour to a new shade is outside the scale.
    const inScale = scaleTokens(register, rule.scale, tokenPath, context).some((t) =>
      valuesEqual('color', t.value, color),
    )
    if (inScale) return []
    const near = nearestInScale(register, rule.scale, color, tokenPath, context)
    return [
      violation(
        decision,
        op.path,
        'outside_scale',
        {
          value: formatValue('color', color),
          scale: rule.scale,
          ...(near ? { nearest: near.path, distance: near.distance } : {}),
          ...where,
        },
        near?.path,
      ),
    ]
  }
  if (rule.kind === 'min_contrast') {
    const color = introducedColor(op)
    if (!color || !tokenPath) return []
    const isFg = matchPath(rule.foreground, op.path)
    const isBg = matchPath(rule.background, op.path)
    if (!isFg && !isBg) return []
    // Contrast holds within one context: dark text is measured against dark surfaces.
    let worst: { path: string; ratio: number; context?: ModeContext | undefined } | undefined
    for (const ctx of reachedContexts(register, op, tokenPath)) {
      const others = colorTokens(
        tokensInContext(register, ctx).values(),
        isFg ? rule.background : rule.foreground,
        tokenPath,
      )
      for (const other of others) {
        const ratio = contrastRatio(color, other.value as ColorValue)
        if (ratio < rule.ratio && (!worst || ratio < worst.ratio))
          worst = { path: other.path, ratio: Math.round(ratio * 100) / 100, context: ctx }
      }
    }
    return worst
      ? [
          violation(decision, op.path, 'low_contrast', {
            against: worst.path,
            ratio: worst.ratio,
            required: rule.ratio,
            ...(worst.context ? { context: contextLabel(worst.context) } : {}),
          }),
        ]
      : []
  }
  return []
}

/**
 * Contrast of the register as it stands, in every context: each `min_contrast` rule for every foreground and
 * background pair, light and dark alike. One violation per foreground and context, against its worst background.
 */
export function auditContrast(register: RuleRegister & Pick<Register, 'decisions'>): Violation[] {
  const out: Violation[] = []
  const contexts = [undefined, ...otherContexts(register).map((c) => modeContext(register, c))]
  for (const decision of activeDecisions(register))
    for (const check of decision.checks) {
      if (check.type !== 'deterministic' || check.rule.kind !== 'min_contrast') continue
      const rule = check.rule
      for (const ctx of contexts) {
        const tokens = [...tokensInContext(register, ctx).values()]
        for (const fg of colorTokens(tokens, rule.foreground)) {
          let worst: { path: string; ratio: number } | undefined
          for (const bg of colorTokens(tokens, rule.background, fg.path)) {
            const ratio = contrastRatio(fg.value as ColorValue, bg.value as ColorValue)
            if (ratio < rule.ratio && (!worst || ratio < worst.ratio))
              worst = { path: bg.path, ratio: Math.round(ratio * 100) / 100 }
          }
          if (worst)
            out.push(
              violation(decision, `tokens.${fg.path}`, 'low_contrast', {
                against: worst.path,
                ratio: worst.ratio,
                required: rule.ratio,
                ...(ctx ? { context: contextLabel(ctx) } : {}),
              }),
            )
        }
      }
    }
  return out
}

/** A colour that has no value of its own in a context and shows its default (light) value there (F15). */
export interface ContextFallback {
  /** Token path without `tokens.`. */
  path: string
  context: string
}

/**
 * Colours without a value of their own in a non-default context: there they keep the default value, which
 * for a dark mode usually is an oversight (a light surface in dark). A warning, never an error (F15).
 * Palette colours that other tokens point to are left out: they are the same in every context on purpose.
 */
export function contextFallbacks(register: RuleRegister): ContextFallback[] {
  const contexts = otherContexts(register)
  if (contexts.length === 0) return []
  const targets = new Set<string>()
  for (const tokens of [register.tokens, ...(register.modes?.tokens.values() ?? [])])
    for (const t of tokens.values()) if (t.aliasOf !== undefined) targets.add(t.aliasOf)
  const out: ContextFallback[] = []
  for (const context of contexts) {
    const differs = new Set(tokensDifferingIn(register, context).map((t) => t.path))
    for (const t of register.tokens.values()) {
      if (t.type !== 'color' || t.value === undefined || t.inheritedFrom !== undefined || t.deprecated)
        continue
      if (differs.has(t.path) || targets.has(t.path)) continue
      out.push({ path: t.path, context })
    }
  }
  return out
}

/** Deterministic checks for a literal value (hard-coded colour in code, new colour in a draft). */
export function checkLiteral(
  register: RuleRegister & Pick<Register, 'decisions'>,
  literal: LiteralUse,
  source: SurfaceId,
): Violation[] {
  if (literal.allowed || literal.inlineOnly) return []
  const at = `${literal.file}:${literal.line}:${literal.column}`
  const out: Violation[] = []
  for (const decision of activeDecisions(register)) {
    for (const check of decision.checks) {
      if (check.type !== 'deterministic') continue
      const rule = check.rule
      if (rule.kind === 'no_raw_values' && decisionCoversFile(decision, literal.file)) {
        if (!(rule.types as string[]).includes(literal.kind)) continue
        out.push(
          violation(
            decision,
            at,
            'raw_value',
            {
              value: literal.raw,
              ...(literal.near ? { nearest: literal.near.path, distance: literal.near.distance } : {}),
            },
            literal.replacement ?? literal.near?.path,
          ),
        )
      }
      // A draft that brings a colour outside the scale (code literals are covered by no_raw_values).
      if (
        rule.kind === 'value_in_scale' &&
        source !== 'code' &&
        literal.kind === 'color' &&
        governsColors(decision, register)
      ) {
        const color = literal.value as ColorValue
        if (scaleTokens(register, rule.scale).some((t) => valuesEqual('color', t.value, color))) continue
        const near = nearestInScale(register, rule.scale, color)
        out.push(
          violation(
            decision,
            at,
            'outside_scale',
            {
              value: literal.raw,
              scale: rule.scale,
              ...(near ? { nearest: near.path, distance: near.distance } : {}),
            },
            near?.path,
          ),
        )
      }
    }
  }
  return out
}
