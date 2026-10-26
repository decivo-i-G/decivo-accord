import { parse as parseYaml } from 'yaml'
import type { z } from 'zod'
import { parseTokens, type TokenFile } from './dtcg/parse.js'
import type { Group, Token } from './dtcg/types.js'
import { hasErrors, type Issue } from './issues.js'
import { type RegisterModes, resolveModes } from './modes/contexts.js'
import { RESOLVER_FILE, readResolver } from './modes/resolver.js'
import { lintOwnership } from './ownership.js'
import { matchPath } from './paths.js'
import { type ComponentContract, ComponentSchema } from './schema/component.js'
import { type Config, ConfigSchema } from './schema/config.js'
import { type Decision, DecisionSchema } from './schema/decision.js'

export const CONFIG_FILE = 'accord.config.yaml'

export interface RegisterFile {
  /** Path relative to the register root (`.accord/`), with forward slashes. */
  path: string
  content: string
}

export interface Register {
  config: Config
  tokens: Map<string, Token>
  groups: Map<string, Group>
  components: Map<string, ComponentContract & { file: string }>
  decisions: Map<string, Decision & { file: string }>
  /** Contexts such as light and dark, from `resolver.json` (DTCG Resolver Module). Undefined without one. */
  modes?: RegisterModes | undefined
  issues: Issue[]
}

export const isTokenFile = (path: string) => /^tokens\/.+\.tokens(\.json)?$/.test(path)
const isComponentFile = (path: string) => /^components\/[^/]+\.ya?ml$/.test(path)
const isDecisionFile = (path: string) => /^decisions\/[^/]+\.ya?ml$/.test(path)

function zodIssues(error: z.ZodError, file: string, prefix?: string): Issue[] {
  return error.issues.map((issue) => {
    const path = [prefix, ...issue.path.map(String)].filter(Boolean).join('.')
    const out: Issue = { severity: 'error', code: 'schema', file, message: issue.message }
    if (path) out.path = path
    return out
  })
}

function parseYamlFile(file: RegisterFile, issues: Issue[]): unknown {
  try {
    return parseYaml(file.content)
  } catch (error) {
    issues.push({ severity: 'error', code: 'yaml', file: file.path, message: (error as Error).message })
    return undefined
  }
}

/** Build and validate a register from its files. Pure: no file system access. */
export function buildRegister(files: readonly RegisterFile[]): Register {
  const issues: Issue[] = []

  const configFile = files.find((f) => f.path === CONFIG_FILE)
  let config = ConfigSchema.parse({ version: 1 })
  if (!configFile) {
    issues.push({
      severity: 'error',
      code: 'missing-config',
      file: CONFIG_FILE,
      message: 'accord.config.yaml is missing',
    })
  } else {
    const result = ConfigSchema.safeParse(parseYamlFile(configFile, issues) ?? {})
    if (result.success) config = result.data
    else issues.push(...zodIssues(result.error, configFile.path))
  }

  const tokenFiles: TokenFile[] = []
  for (const file of files.filter((f) => isTokenFile(f.path))) {
    try {
      tokenFiles.push({ file: file.path, content: JSON.parse(file.content) })
    } catch (error) {
      issues.push({ severity: 'error', code: 'json', file: file.path, message: (error as Error).message })
    }
  }
  const { tokens, groups, issues: tokenIssues } = parseTokens(tokenFiles)
  issues.push(...tokenIssues)

  // Contexts (light/dark): only with resolver.json. Without it the register is exactly what it was before.
  let modes: RegisterModes | undefined
  const resolverFile = files.find((f) => f.path === RESOLVER_FILE)
  const known = new Set(files.map((f) => f.path))
  if (resolverFile) {
    const resolver = readResolver(resolverFile.content, (p) => known.has(p), isTokenFile)
    issues.push(...resolver.issues)
    if (resolver.model) {
      const contents = new Map(files.map((f) => [f.path, f.content]))
      const resolved = resolveModes(resolver.model, tokenFiles, { tokens, issues: tokenIssues }, (p) =>
        contents.get(p),
      )
      issues.push(...resolved.issues)
      modes = resolved.modes
      for (const file of tokenFiles.map((f) => f.file))
        if (!resolver.model.setFiles.includes(file))
          issues.push({
            severity: 'warning',
            code: 'resolver-missing-set-file',
            file: RESOLVER_FILE,
            message: `${file} is not in any set; tools that read resolver.json will not see its tokens`,
          })
    }
  }
  const referenced = new Set(modes ? [...modes.files.values()].flat() : [])
  for (const file of files)
    if (file.path.startsWith('modes/') && !referenced.has(file.path))
      issues.push({
        severity: 'warning',
        code: 'unreferenced-mode-file',
        file: file.path,
        message: resolverFile
          ? 'no context of resolver.json uses this file; its values do not apply'
          : 'there is no resolver.json, so this file does not apply',
      })

  const components = new Map<string, ComponentContract & { file: string }>()
  for (const file of files.filter((f) => isComponentFile(f.path))) {
    const result = ComponentSchema.safeParse(parseYamlFile(file, issues))
    if (!result.success) {
      issues.push(...zodIssues(result.error, file.path))
      continue
    }
    const existing = components.get(result.data.name)
    if (existing) {
      issues.push({
        severity: 'error',
        code: 'duplicate-component',
        file: file.path,
        path: result.data.name,
        message: `already defined in ${existing.file}`,
      })
      continue
    }
    components.set(result.data.name, { ...result.data, file: file.path })
  }

  const decisions = new Map<string, Decision & { file: string }>()
  for (const file of files.filter((f) => isDecisionFile(f.path))) {
    const result = DecisionSchema.safeParse(parseYamlFile(file, issues))
    if (!result.success) {
      issues.push(...zodIssues(result.error, file.path))
      continue
    }
    const decision = result.data
    if (decisions.has(decision.id)) {
      issues.push({
        severity: 'error',
        code: 'duplicate-decision',
        file: file.path,
        path: decision.id,
        message: 'duplicate id',
      })
      continue
    }
    if (!file.path.split('/').pop()?.startsWith(`${decision.id}`)) {
      issues.push({
        severity: 'warning',
        code: 'decision-filename',
        file: file.path,
        path: decision.id,
        message: `file name should start with ${decision.id}`,
      })
    }
    decisions.set(decision.id, { ...decision, file: file.path })
  }

  const register: Register = { config, tokens, groups, components, decisions, issues }
  if (modes) register.modes = modes
  issues.push(...crossCheck(register), ...lintOwnership(register))
  return register
}

/** Every path a scope or rule pattern could match: tokens.*, components.<Name>.<field>.… */
export function registerPaths(register: Pick<Register, 'tokens' | 'components' | 'decisions'>): string[] {
  const paths: string[] = []
  for (const path of register.tokens.keys()) paths.push(`tokens.${path}`)
  for (const component of register.components.values()) {
    const base = `components.${component.name}`
    paths.push(base)
    // The fields exist on every contract, even when still empty, so ownership rules for them are valid.
    for (const field of ['variants', 'props', 'states', 'slots']) paths.push(`${base}.${field}`)
    for (const axis of Object.keys(component.variants)) paths.push(`${base}.variants.${axis}`)
    for (const prop of Object.keys(component.props)) paths.push(`${base}.props.${prop}`)
    for (const state of component.states) paths.push(`${base}.states.${state}`)
    for (const slot of Object.keys(component.slots)) paths.push(`${base}.slots.${slot}`)
  }
  for (const id of register.decisions.keys()) paths.push(`decisions.${id}`)
  return paths
}

function crossCheck(register: Register): Issue[] {
  const issues: Issue[] = []
  const paths = registerPaths(register)

  const checkPattern = (pattern: string, file: string, where: string) => {
    if (pattern.startsWith('code:')) return
    if (paths.some((p) => matchPath(pattern, p))) return
    const deeper = pattern.endsWith('.*') ? `${pattern}*` : undefined
    const hint =
      deeper && paths.some((p) => matchPath(deeper, p))
        ? ` (did you mean ${deeper}? "*" matches one level only)`
        : ''
    issues.push({
      severity: 'warning',
      code: 'pattern-matches-nothing',
      file,
      path: where,
      message: `${pattern} matches nothing${hint}`,
    })
  }

  for (const rule of register.config.ownership.rules) checkPattern(rule.match, CONFIG_FILE, 'ownership.rules')

  for (const decision of register.decisions.values()) {
    for (const scope of decision.scope) checkPattern(scope, decision.file, `${decision.id}.scope`)
    for (const id of decision.supersedes ?? []) {
      if (!register.decisions.has(id)) {
        issues.push({
          severity: 'error',
          code: 'unknown-decision',
          file: decision.file,
          path: decision.id,
          message: `supersedes unknown ${id}`,
        })
      }
    }
    for (const check of decision.checks) {
      if (check.type !== 'deterministic') continue
      const rule = check.rule
      const patterns =
        rule.kind === 'value_in_scale'
          ? [rule.scale]
          : rule.kind === 'min_contrast'
            ? [rule.foreground, rule.background]
            : []
      for (const p of patterns) checkPattern(p, decision.file, `${decision.id}.checks`)
    }
  }

  for (const component of register.components.values()) {
    for (const token of component.tokens) {
      if (!register.tokens.has(token)) {
        issues.push({
          severity: 'error',
          code: 'unknown-token',
          file: component.file,
          path: `${component.name}.tokens`,
          message: `token ${token} does not exist`,
        })
      }
    }
  }

  for (const token of register.tokens.values()) {
    for (const id of token.accord?.decisions ?? []) {
      if (!register.decisions.has(id)) {
        issues.push({
          severity: 'error',
          code: 'unknown-decision',
          file: token.file,
          path: token.path,
          message: `refers to unknown ${id}`,
        })
      }
    }
  }
  return issues
}

export const isValidRegister = (register: Register) => !hasErrors(register.issues)
