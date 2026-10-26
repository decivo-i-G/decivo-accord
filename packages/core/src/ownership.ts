import type { Owner } from './dtcg/types.js'
import type { Issue } from './issues.js'
import { compareSpecificity, joinPath, matchPath, splitPath } from './paths.js'
import type { Register } from './register.js'

/**
 * Which part of a register entry a change touches. Only `value` follows the ownership rules;
 * names, existence (add/remove) and deprecation always belong to the register.
 */
export type Aspect = 'value' | 'name' | 'existence' | 'deprecation'

export type OwnerSource =
  | { kind: 'fixed'; reason: string }
  | { kind: 'token'; path: string; file: string }
  | { kind: 'group'; path: string; file: string }
  | { kind: 'component'; component: string; pattern: string; file: string }
  | { kind: 'rule'; pattern: string; index: number }
  | { kind: 'default' }

export interface OwnerResolution {
  owner: Owner
  source: OwnerSource
}

type OwnershipInput = Pick<Register, 'config' | 'tokens' | 'groups' | 'components'>

const FIXED_REGISTER_PREFIXES = ['decisions', 'config']

/** Owner of a register path (`tokens.color.brand.700`, `components.Button.props.disabled`, …). */
export function resolveOwner(
  register: OwnershipInput,
  path: string,
  aspect: Aspect = 'value',
): OwnerResolution {
  const segs = splitPath(path)
  const kind = segs[0]

  if (aspect !== 'value') {
    return {
      owner: 'register',
      source: {
        kind: 'fixed',
        reason: 'names, additions, deletions and deprecations belong to the register',
      },
    }
  }
  if (kind && FIXED_REGISTER_PREFIXES.includes(kind)) {
    return {
      owner: 'register',
      source: { kind: 'fixed', reason: 'rules and ownership rules belong to the register' },
    }
  }

  if (kind === 'tokens') {
    const tokenPath = joinPath(segs.slice(1))
    const token = register.tokens.get(tokenPath)
    if (token?.accord?.owner)
      return { owner: token.accord.owner, source: { kind: 'token', path: tokenPath, file: token.file } }
    const groupSegs = splitPath(tokenPath)
    for (let i = token ? groupSegs.length - 1 : groupSegs.length; i >= 0; i--) {
      const groupPath = joinPath(groupSegs.slice(0, i))
      const group = register.groups.get(groupPath)
      if (group?.accord?.owner)
        return { owner: group.accord.owner, source: { kind: 'group', path: groupPath, file: group.file } }
    }
  }

  if (kind === 'components' && segs[1]) {
    const component = register.components.get(segs[1])
    const field = joinPath(segs.slice(2))
    if (component && field) {
      const match = mostSpecific(Object.keys(component.owners), (pattern) => matchPath(pattern, field))
      if (match !== undefined) {
        return {
          owner: component.owners[match] as Owner,
          source: { kind: 'component', component: component.name, pattern: match, file: component.file },
        }
      }
    }
  }

  const rules = register.config.ownership.rules
  const index = mostSpecificIndex(
    rules.map((r) => r.match),
    (pattern) => matchPath(pattern, path),
  )
  if (index !== undefined) {
    const rule = rules[index]
    if (rule) return { owner: rule.owner, source: { kind: 'rule', pattern: rule.match, index } }
  }

  return { owner: register.config.ownership.default, source: { kind: 'default' } }
}

function mostSpecificIndex(
  patterns: readonly string[],
  matches: (pattern: string) => boolean,
): number | undefined {
  let best: number | undefined
  patterns.forEach((pattern, i) => {
    if (!matches(pattern)) return
    if (best === undefined || compareSpecificity(pattern, patterns[best] as string) > 0) best = i
  })
  return best
}

function mostSpecific(
  patterns: readonly string[],
  matches: (pattern: string) => boolean,
): string | undefined {
  const i = mostSpecificIndex(patterns, matches)
  return i === undefined ? undefined : patterns[i]
}

/** One line per step, for `accord explain-owner`. */
export function explainOwner(register: OwnershipInput, path: string, aspect: Aspect = 'value'): string {
  const { owner, source } = resolveOwner(register, path, aspect)
  const why = (() => {
    switch (source.kind) {
      case 'fixed':
        return `fixed: ${source.reason}`
      case 'token':
        return `$extensions on the token in ${source.file}`
      case 'group':
        return `$extensions on group "${source.path || '(root)'}" in ${source.file}`
      case 'component':
        return `owners["${source.pattern}"] in ${source.file}`
      case 'rule':
        return `ownership rule #${source.index + 1} "${source.pattern}" in accord.config.yaml`
      case 'default':
        return 'ownership.default in accord.config.yaml'
    }
  })()
  return `${path} → ${owner} (${why})`
}

/** Warnings about the ownership setup itself. */
export function lintOwnership(register: OwnershipInput): Issue[] {
  const issues: Issue[] = []
  const rules = register.config.ownership.rules

  rules.forEach((rule, i) => {
    if (
      FIXED_REGISTER_PREFIXES.some((p) => matchPath(rule.match, p) || rule.match.startsWith(`${p}.`)) &&
      rule.owner !== 'register'
    ) {
      issues.push({
        severity: 'error',
        code: 'ownership-fixed',
        file: 'accord.config.yaml',
        path: `ownership.rules.${i}`,
        message: `${rule.match} always belongs to the register`,
      })
    }
    rules.forEach((other, j) => {
      if (j <= i || other.match !== rule.match || other.owner === rule.owner) return
      issues.push({
        severity: 'error',
        code: 'ownership-conflict',
        file: 'accord.config.yaml',
        path: `ownership.rules.${j}`,
        message: `${other.match} is assigned to both ${rule.owner} and ${other.owner}`,
      })
    })
  })

  // Many token-level exceptions usually mean the group default is wrong.
  const tokens = [...register.tokens.values()].filter((t) => t.inheritedFrom === undefined)
  const exceptions = tokens.filter((t) => {
    if (!t.accord?.owner) return false
    const { owner: _exception, ...accord } = t.accord
    const withoutException = resolveOwner(
      { ...register, tokens: new Map([[t.path, { ...t, accord }]]) },
      `tokens.${t.path}`,
    )
    return withoutException.owner !== t.accord.owner
  })
  if (tokens.length >= 10 && exceptions.length / tokens.length > 0.2) {
    issues.push({
      severity: 'warning',
      code: 'ownership-exceptions',
      message: `${exceptions.length} of ${tokens.length} tokens override their owner; consider changing the group or rule default`,
    })
  }
  return issues
}
