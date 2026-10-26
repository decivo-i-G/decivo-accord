import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { gunzipSync, strFromU8, unzipSync } from 'fflate'

/** A Claude Design handoff: the design pages and stylesheets, read as data. */
export interface HandoffBundle {
  name: string
  /** Page the designer had open when handing off (from the bundle README), if known. */
  primary?: string | undefined
  pages: { path: string; title?: string | undefined; html: string }[]
  styles: { path: string; css: string }[]
}

const MAX_FILE = 5 * 1024 * 1024
const isPage = (path: string) =>
  /\.dc\.html$/i.test(path) || (/\.html?$/i.test(path) && !/(^|\/)screenshots\//.test(path))

/** README of a handoff names the primary file: "Read `<slug>/project/<file>.dc.html` in full." */
function primaryFrom(readme: string | undefined): string | undefined {
  return readme ? /Read `([^`]+\.dc\.html)`/.exec(readme)?.[1] : undefined
}

const titleOf = (html: string) => /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim()

function fromEntries(name: string, entries: Map<string, string>): HandoffBundle {
  const readme = [...entries].find(([path]) => /(^|\/)README\.md$/i.test(path))?.[1]
  const pages = [...entries]
    .filter(([path]) => isPage(path))
    .map(([path, html]) => ({ path, title: titleOf(html), html }))
    .sort((a, b) => a.path.localeCompare(b.path))
  const styles = [...entries]
    .filter(([path]) => /\.css$/i.test(path))
    .map(([path, css]) => ({ path, css }))
    .sort((a, b) => a.path.localeCompare(b.path))
  return { name, primary: primaryFrom(readme), pages, styles }
}

/**
 * Pages of a single-file export: the bundler keeps each page gzip+base64 in a JSON manifest and
 * its markup in a `__bundler/template` script.
 */
export function unpackBundledHtml(html: string, path: string): HandoffBundle['pages'] {
  const block = (type: string, source: string) =>
    new RegExp(`<script type="__bundler/${type}">([\\s\\S]*?)</script>`).exec(source)?.[1]
  const manifestText = block('manifest', html)
  if (!manifestText) return [{ path, title: titleOf(html), html }]
  const manifest = JSON.parse(manifestText) as Record<
    string,
    { mime: string; compressed?: boolean; data: string }
  >
  const order = JSON.parse(block('page_order', html) ?? '[]') as string[]
  const pages: HandoffBundle['pages'] = []
  for (const id of order.length > 0 ? order : Object.keys(manifest)) {
    const entry = manifest[id]
    if (entry?.mime !== 'text/html') continue
    const bytes = Uint8Array.from(Buffer.from(entry.data, 'base64'))
    const page = strFromU8(entry.compressed ? gunzipSync(bytes) : bytes)
    const template = block('template', page)
    const markup = template ? (JSON.parse(template) as string) : page
    pages.push({ path: `${path}#${id}`, title: titleOf(markup), html: markup })
  }
  return pages
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'))
}

/** Read a handoff from a `.zip`, an extracted folder, a single-file `.html` export or one `.dc.html` page. */
export async function readHandoff(path: string): Promise<HandoffBundle> {
  const info = await stat(path)
  const name = basename(path).replace(/(-handoff)?\.(zip|html?)$/i, '')

  if (info.isDirectory()) {
    const entries = new Map<string, string>()
    for (const file of await walk(path)) {
      if (!/\.(html?|css|md)$/i.test(file)) continue
      const full = join(path, file)
      if ((await stat(full)).size > MAX_FILE) continue
      entries.set(file, await readFile(full, 'utf8'))
    }
    return fromEntries(name, entries)
  }

  if (/\.zip$/i.test(path)) {
    const files = unzipSync(new Uint8Array(await readFile(path)), {
      filter: (f) => /\.(html?|css|md)$/i.test(f.name) && f.originalSize <= MAX_FILE,
    })
    return fromEntries(name, new Map(Object.entries(files).map(([p, bytes]) => [p, strFromU8(bytes)])))
  }

  const html = await readFile(path, 'utf8')
  return { name, pages: unpackBundledHtml(html, basename(path)), styles: [] }
}
