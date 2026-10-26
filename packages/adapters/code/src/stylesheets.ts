import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path'
import postcss from 'postcss'
import valueParser from 'postcss-value-parser'
import { glob } from 'tinyglobby'
import { type CssVariable, parseCssVariables } from './css-vars.js'

/** An `@import` that was not followed, and why. */
export interface SkippedImport {
  /** Stylesheet with the `@import`, relative to the root. */
  from: string
  /** What it imports, as written. */
  import: string
  /**
   * remote: a URL (fonts, CDNs). package: a dependency outside the repository (e.g. `tailwindcss`), whose
   * defaults are not the product's design decisions. missing: nothing found. cycle: already being read.
   */
  reason: 'remote' | 'package' | 'missing' | 'cycle'
}

export interface Stylesheets {
  /** Custom properties in cascade order: an imported file's variables come where its `@import` is. */
  variables: CssVariable[]
  /** Every stylesheet read, entries and imports, relative to the root. */
  files: string[]
  skipped: SkippedImport[]
}

const posix = (path: string) => path.split(sep).join('/')
const inside = (root: string, path: string) => {
  const rel = relative(root, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}
const isFile = (path: string) =>
  stat(path).then(
    (s) => s.isFile(),
    () => false,
  )

/** Workspace packages by name (`@acme/tokens` → `packages/tokens`), found without installing anything. */
const workspaces = new Map<string, Promise<Map<string, string>>>()
function workspacePackages(root: string): Promise<Map<string, string>> {
  let found = workspaces.get(root)
  if (!found) {
    found = (async () => {
      const out = new Map<string, string>()
      const files = await glob(['**/package.json'], {
        cwd: root,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.next/**'],
        deep: 5,
      })
      for (const file of files.sort()) {
        try {
          const name = (JSON.parse(await readFile(join(root, file), 'utf8')) as { name?: unknown }).name
          if (typeof name === 'string' && !out.has(name)) out.set(name, dirname(join(root, file)))
        } catch {
          // Not a package manifest we can read; it cannot be imported by name either.
        }
      }
      return out
    })()
    workspaces.set(root, found)
  }
  return found
}

/** The stylesheet a package exports: `style`, a CSS entry in `exports`, else `index.css`. */
async function packageStylesheet(dir: string): Promise<string> {
  try {
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>
    const exported = manifest.exports
    const main =
      typeof exported === 'object' && exported !== null
        ? (exported as Record<string, unknown>)['.']
        : exported
    const fromExports =
      typeof main === 'string'
        ? main
        : typeof main === 'object' && main !== null
          ? ['style', 'import', 'default']
              .map((k) => (main as Record<string, unknown>)[k])
              .find((v) => typeof v === 'string')
          : undefined
    for (const candidate of [manifest.style, fromExports])
      if (typeof candidate === 'string' && candidate.endsWith('.css')) return join(dir, candidate)
  } catch {
    // No manifest: fall back to the usual file name.
  }
  return join(dir, 'index.css')
}

/**
 * Where an `@import` points: a file relative to the importing stylesheet, or a stylesheet of a package that
 * lives in the repository (a workspace package, also when linked through node_modules). Dependencies installed
 * from a registry and URLs are not followed.
 */
async function resolveImport(
  root: string,
  from: string,
  spec: string,
): Promise<string | SkippedImport['reason']> {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(spec)) return 'remote'
  const base = dirname(join(root, from))
  const local = async (path: string) => ((await isFile(path)) && inside(root, path) ? path : undefined)
  const withCss = async (path: string) => (await local(path)) ?? (await local(`${path}.css`))

  if (spec.startsWith('/')) return (await withCss(join(root, spec))) ?? 'missing'
  if (spec.startsWith('.')) return (await withCss(normalize(join(base, spec)))) ?? 'missing'
  // A bare name is relative first ("theme.css" next to the file), as postcss-import resolves it.
  const bare = spec.replace(/^~/, '')
  if (!spec.startsWith('~')) {
    const relativeFile = await local(normalize(join(base, bare)))
    if (relativeFile) return relativeFile
  }

  const parts = bare.split('/')
  const name = bare.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] as string)
  const rest = parts.slice(bare.startsWith('@') ? 2 : 1).join('/')
  let dir = (await workspacePackages(root)).get(name)
  if (!dir) {
    const linked = join(root, 'node_modules', name)
    const real = await realpath(linked).catch(() => undefined)
    if (!real) return 'missing'
    const realRoot = await realpath(root).catch(() => root)
    // Installed dependencies (also pnpm's store) are not the product's own stylesheets.
    if (!inside(realRoot, real) || relative(realRoot, real).split(sep).includes('node_modules'))
      return 'package'
    dir = join(root, relative(realRoot, real))
  }
  const file = rest ? await withCss(join(dir, rest)) : await local(await packageStylesheet(dir))
  return file ?? 'missing'
}

/** URL and condition of an `@import`: `url("a.css") layer(x) (prefers-color-scheme: dark)`. */
function parseImport(params: string): { url?: string | undefined; condition?: string | undefined } {
  const nodes = valueParser(params).nodes.filter((n) => n.type !== 'space' && n.type !== 'comment')
  const first = nodes[0]
  const url =
    first?.type === 'string'
      ? first.value
      : first?.type === 'function' && first.value === 'url'
        ? first.nodes.map((n) => n.value).join('')
        : undefined
  let supports: string | undefined
  const media: string[] = []
  for (const node of nodes.slice(1)) {
    if (node.type === 'function' && node.value === 'layer') continue
    if (node.type === 'word' && node.value === 'layer') continue
    if (node.type === 'function' && node.value === 'supports')
      supports = `@supports (${valueParser.stringify(node.nodes)})`
    else media.push(valueParser.stringify(node))
  }
  const condition = media.length > 0 ? `@media ${media.join(' ')}` : supports
  return { url, condition }
}

/**
 * Read stylesheets and everything they `@import`, the way the browser cascade sees them: imported variables
 * first, in import order. An import under a media condition (prefers-color-scheme: dark)
 * puts its variables under that condition. Cycles and repeated imports are read once.
 */
export async function readStylesheets(root: string, entries: readonly string[]): Promise<Stylesheets> {
  const variables: CssVariable[] = []
  const files: string[] = []
  const skipped: SkippedImport[] = []
  const done = new Set<string>()

  const visit = async (file: string, stack: string[], wrap: string | undefined): Promise<void> => {
    if (stack.includes(file)) {
      skipped.push({ from: stack.at(-1) as string, import: file, reason: 'cycle' })
      return
    }
    if (done.has(file)) return
    done.add(file)
    const css = await readFile(join(root, file), 'utf8').catch(() => undefined)
    if (css === undefined) return
    files.push(file)
    const parsed = postcss.parse(css, { from: file })
    for (const node of parsed.nodes) {
      if (node.type !== 'atrule' || node.name !== 'import') continue
      const { url, condition } = parseImport(node.params)
      if (!url) continue
      const target = await resolveImport(root, file, url)
      if (target === 'remote' || target === 'package' || target === 'missing') {
        skipped.push({ from: file, import: url, reason: target })
        continue
      }
      await visit(posix(relative(root, target)), [...stack, file], condition ?? wrap)
    }
    for (const v of parseCssVariables(css, file))
      variables.push(wrap ? { ...v, scope: wrap, context: `${wrap} › ${v.context}` } : v)
  }

  for (const entry of entries) await visit(posix(normalize(entry)), [], undefined)
  return { variables, files, skipped }
}
