import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { figmaStatus, readFigmaExports } from '@decivo/accord-adapter-figma'
import {
  colorToCss,
  cssToColor,
  LOCK_FILE,
  otherContexts,
  parseLock,
  type Register,
  setsInContext,
  type Token,
  tokensInContext,
} from '@decivo/accord-core'
import type { Project } from './projects'
import { previewOf, valueText } from './register-view'

/**
 * Modes next to the register, one value column per mode like Figma's variables panel. With a
 * `resolver.json` the register holds every context itself (light, dark, …) and the columns come from it.
 * Without one, the register holds a single value per token; Figma's other modes are then shown as Figma
 * reports them, marked as living only there.
 */

/** One value in another mode, ready to draw: text, and the CSS colour for a swatch. */
export interface ModeValue {
  text: string
  color?: string | undefined
}

export interface ModeView {
  /** Where the other columns come from: the register's own contexts, or Figma's modes only. */
  source: 'register' | 'figma'
  /** The mode whose values the register holds (Figma's default mode, or the register's default context). */
  main: string
  /** The other modes, in Figma's order. */
  others: string[]
  /** Tokens the modes apply to (with Figma: those Figma defines). */
  covered: string[]
  /** Values per token and other mode, only where the value there is its own or differs from the main mode. */
  values: Record<string, Record<string, ModeValue>>
}

/** A surface value (CSS string, number or typed DTCG value) in the token's type, for display. */
export function modeValue(token: Pick<Token, 'path' | 'type'>, value: unknown): ModeValue {
  if (token.type === 'color' && typeof value === 'string') {
    const color = cssToColor(value)
    return color ? { text: valueText('color', color), color: colorToCss(color) } : { text: value }
  }
  if (typeof value === 'number') {
    if (token.type === 'dimension') return { text: `${value}px` }
    if (token.type === 'duration') return { text: `${value}ms` }
    return { text: String(value) }
  }
  if (typeof value === 'string') return { text: value }
  const preview = previewOf({ path: token.path, type: token.type, value })
  return {
    text: valueText(token.type, value),
    color: preview.kind === 'color' ? preview.css : undefined,
  }
}

/** What `figmaStatus` reports about modes, structurally typed so tests need no Figma files. */
export interface ModeStatusLike {
  modes: string[]
  defaultMode?: string | undefined
  themed: { path: string; themed: { theme: Record<string, string>; value: unknown }[] }[]
  snapshot: { tokens: ReadonlyMap<string, unknown> }
}

/** The mode view of a Figma status; `undefined` when Figma has a single mode (nothing to show). */
export function modeView(status: ModeStatusLike, register: Pick<Register, 'tokens'>): ModeView | undefined {
  const main = status.defaultMode ?? status.modes[0]
  if (!main) return undefined
  const mains = new Set(main.split(',').map((m) => m.trim()))
  const others = status.modes.filter((m) => !mains.has(m))
  if (others.length === 0) return undefined
  const values: ModeView['values'] = {}
  for (const { path, themed } of status.themed) {
    const token = register.tokens.get(path)
    if (!token) continue
    for (const { theme, value } of themed) {
      const mode = theme.mode
      if (!mode || !others.includes(mode)) continue
      const entry = values[path] ?? {}
      entry[mode] = modeValue(token, value)
      values[path] = entry
    }
  }
  return { source: 'figma', main, others, covered: [...status.snapshot.tokens.keys()], values }
}

/**
 * The register's own contexts: a token has a value in a context where the context sets it or where it
 * resolves differently there (an alias to a token the context sets). Undefined without modes.
 */
export function contextView(register: Pick<Register, 'tokens' | 'modes'>): ModeView | undefined {
  const modes = register.modes
  const others = otherContexts(register)
  if (!modes || others.length === 0) return undefined
  const values: ModeView['values'] = {}
  for (const context of others) {
    const inContext = tokensInContext(register, context)
    for (const [path, token] of register.tokens) {
      const there = inContext.get(path)
      if (!there || there.value === undefined) continue
      const own = setsInContext(register, context, path)
      if (!own && JSON.stringify(there.value) === JSON.stringify(token.value)) continue
      const entry = values[path] ?? {}
      entry[context] = modeValue(token, there.value)
      values[path] = entry
    }
  }
  return { source: 'register', main: modes.default, others, covered: [...register.tokens.keys()], values }
}

/** Modes for the register screen: the register's contexts, else those of Figma when Figma is switched on. */
export async function registerModes(
  project: Project,
  register: Register,
  registerDir: string,
): Promise<ModeView | undefined> {
  const own = contextView(register)
  if (own) return own
  const config = register.config.surfaces.figma
  if (!config.enabled) return undefined
  const [exports, lockText] = await Promise.all([
    readFigmaExports(project.root, config.include),
    readFile(join(registerDir, LOCK_FILE), 'utf8').catch(() => undefined),
  ])
  if (exports.length === 0) return undefined
  const status = figmaStatus(exports, register, parseLock(lockText), { defaultMode: config.default_mode })
  return modeView(status, register)
}
