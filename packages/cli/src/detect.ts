import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDefaultThemeScope, readStylesheets } from '@decivo/accord-adapter-code'
import { glob } from 'tinyglobby'

/** What `accord init` found in a repository. Paths are relative to the repository root. */
export interface DetectedSources {
  designMd: string[]
  /** Token files and their format. */
  tokens: { path: string; format: 'dtcg' | 'tokens-studio' }[]
  /**
   * Stylesheets that define custom properties (`:root`, `@theme`, a light `[data-theme]`), themselves or
   * through `@import`. A stylesheet another detected one imports is left out: the entry is enough.
   */
  css: string[]
  /** shadcn/ui component directory, from `components.json`. */
  uiDir?: string | undefined
  storybook: boolean
  pen: string[]
  /** Figma files (`.fig`) and Figma variable exports in the usual places. */
  figma: string[]
}

const USUAL_STYLESHEETS = [
  'globals',
  'global',
  'theme',
  'tokens',
  'styles',
  'style',
  'index',
  'main',
  'app',
  'variables',
  'vars',
  'base',
  'root',
  'colors',
].map((name) => `**/${name}.css`)

const IGNORE = [
  '**/node_modules/**',
  '**/.next/**',
  '**/dist/**',
  '**/build/**',
  '**/.accord/**',
  '**/storybook-static/**',
  '**/coverage/**',
  '**/.turbo/**',
  '**/out/**',
  '**/vendor/**',
  // Test data is not the design system.
  '**/fixtures/**',
  '**/__fixtures__/**',
  '**/__tests__/**',
]

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** Distinguish DTCG (`$value`) from Tokens Studio (`value` + `type`) by the first leaf found. */
export function tokenFormat(json: unknown): 'dtcg' | 'tokens-studio' | undefined {
  let found: 'dtcg' | 'tokens-studio' | undefined
  const walk = (node: unknown, depth: number): void => {
    if (found || depth > 8 || typeof node !== 'object' || node === null) return
    const obj = node as Record<string, unknown>
    if ('$value' in obj) found = 'dtcg'
    else if ('value' in obj && 'type' in obj) found = 'tokens-studio'
    else for (const child of Object.values(obj)) walk(child, depth + 1)
  }
  walk(json, 0)
  return found
}

/** Resolve a tsconfig-style alias like `@/components/ui` to a directory. */
async function resolveAlias(root: string, alias: string): Promise<string | undefined> {
  const tsconfig = (await readJson(join(root, 'tsconfig.json'))) as
    | { compilerOptions?: { paths?: Record<string, string[]> } }
    | undefined
  for (const [pattern, targets] of Object.entries(tsconfig?.compilerOptions?.paths ?? {})) {
    const prefix = pattern.replace(/\*$/, '')
    const target = targets[0]?.replace(/\*$/, '').replace(/^\.\//, '')
    if (target !== undefined && alias.startsWith(prefix)) return `${target}${alias.slice(prefix.length)}`
  }
  return alias.startsWith('@/') ? `src/${alias.slice(2)}` : undefined
}

export async function detectSources(root: string): Promise<DetectedSources> {
  const designMd = await glob(['DESIGN.md', '*/DESIGN.md', '*/*/DESIGN.md'], { cwd: root, ignore: IGNORE })

  const tokens: DetectedSources['tokens'] = []
  const candidates = await glob(
    ['**/*.tokens.json', '**/*.tokens', '**/tokens.json', '**/design-tokens.json'],
    {
      cwd: root,
      ignore: IGNORE,
      // Monorepos keep token files deep (packages/<pkg>/src/style/themes/figma/…).
      deep: 8,
    },
  )
  for (const path of candidates.sort()) {
    const format = tokenFormat(await readJson(join(root, path)))
    if (format) tokens.push({ path, format })
  }

  const componentsJson = (await readJson(join(root, 'components.json'))) as
    | { tailwind?: { css?: string }; aliases?: { ui?: string } }
    | undefined
  const css: string[] = []
  // components.json may point to a stylesheet that has moved since; only trust it when the file is there.
  const configured = componentsJson?.tailwind?.css
  if (configured && (await exists(join(root, configured)))) css.push(configured)
  // Stylesheets that define custom properties: the usual names first; without one, any stylesheet that does.
  // Imports count: a globals.css that only imports its theme defines that theme's variables.
  const reached = new Map<string, string[]>()
  const definesVariables = async (path: string) => {
    const sheets = await readStylesheets(root, [path]).catch(() => undefined)
    if (!sheets) return false
    reached.set(path, sheets.files.slice(1))
    if (sheets.variables.some((v) => v.scope === 'base' || isDefaultThemeScope(v.scope))) return true
    const texts = await Promise.all(sheets.files.map((f) => readFile(join(root, f), 'utf8').catch(() => '')))
    return texts.some((text) => /(:root|@theme)[^{]*\{[^}]*--/s.test(text))
  }
  for (const patterns of [USUAL_STYLESHEETS, ['**/*.css']]) {
    if (css.length > 0) break
    const found = await glob(patterns, { cwd: root, ignore: IGNORE, deep: 5 })
    const defining: string[] = []
    for (const path of found.sort().slice(0, 200)) if (await definesVariables(path)) defining.push(path)
    // Entries first (they reach the most), so a file imported by an entry is covered by it, also in a cycle.
    const reach = (p: string) => reached.get(p) ?? []
    const covered = new Set<string>()
    for (const path of [...defining].sort(
      (a, b) => reach(b).length - reach(a).length || a.localeCompare(b),
    )) {
      if (covered.has(path)) continue
      css.push(path)
      for (const r of reach(path)) covered.add(r)
    }
  }

  let uiDir: string | undefined
  if (componentsJson?.aliases?.ui) {
    const dir = await resolveAlias(root, componentsJson.aliases.ui)
    if (dir && (await exists(join(root, dir)))) uiDir = dir
  }

  const storybook = (await glob(['.storybook/main.*'], { cwd: root, dot: true })).length > 0
  const pen = await glob(['**/*.pen'], { cwd: root, ignore: IGNORE })
  const figma = await glob(['**/*.fig', 'figma/**/*.json', '**/*.figma.json'], { cwd: root, ignore: IGNORE })

  return {
    designMd: designMd.sort(),
    tokens,
    css: css.sort(),
    uiDir,
    storybook,
    pen: pen.sort(),
    figma: figma.sort(),
  }
}
