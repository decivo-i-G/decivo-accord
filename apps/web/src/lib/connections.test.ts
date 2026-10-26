import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initCommand, translator } from '@decivo/accord-cli'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  codeOutside,
  describeGlob,
  getConnections,
  globRoot,
  includeYaml,
  isToolId,
  setToolEnabled,
  suggestInclude,
  withoutFolders,
  withToolEnabled,
} from './connections'
import type { Project } from './projects'

const fixture = fileURLToPath(new URL('../../../../packages/cli/test/fixtures/shop', import.meta.url))
const figFile = fileURLToPath(
  new URL('../../../../packages/adapters/figma/test/fixtures/fig/corners.fig', import.meta.url),
)
const penFile = fileURLToPath(
  new URL('../../../../packages/adapters/pen/test/fixtures/landing.pen', import.meta.url),
)

describe('connections', () => {
  let dir: string
  let project: Project
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'accord-conn-'))
    await cp(fixture, dir, { recursive: true })
    await initCommand(
      { root: dir, register: '.accord', force: false, dryRun: false },
      translator('de'),
      () => {},
    )
    project = { slug: 'shop', name: 'shop', root: dir, branch: 'main' }
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('lists what the code surface has and that no design file is there yet', async () => {
    const data = await getConnections(project)
    expect(data.registerDir).toBe('.accord')
    expect(data.configFile).toBe('.accord/accord.config.yaml')
    expect(data.code.css).toContain('src/app/globals.css')
    expect(data.code.uiDir).toBe('src/components/ui')
    expect(data.code.tokens.map((t) => t.path)).toEqual(['design/tokens.json'])
    expect(data.code.designMd).toEqual(['design/DESIGN.md'])
    expect(data.figma).toMatchObject({ enabled: false, files: [], outside: [] })
    expect(data.pen).toMatchObject({ enabled: false, files: [], outside: [] })
    expect(data.claudeDesign.enabled).toBe(false)
  })

  it('finds a .fig file and a .pen file and says what it read', async () => {
    await mkdir(join(dir, 'figma'), { recursive: true })
    await cp(figFile, join(dir, 'figma/app.fig'))
    await cp(penFile, join(dir, 'design/landing.pen'))
    const data = await getConnections(project)
    const fig = data.figma.files.find((f) => f.path === 'figma/app.fig')
    expect(fig?.format).toBe('fig')
    // This file has corner radii but no variables: Accord says so instead of failing.
    expect(fig?.variables).toBe(0)
    expect(fig?.errors.join(' ')).toContain('no variables')
    expect(data.pen.files.map((f) => f.path)).toEqual(['design/landing.pen'])
    expect(data.pen.files[0]?.variables).toBeGreaterThan(0)
  })

  it('reports Figma files that the configured paths do not cover', async () => {
    const path = join(dir, '.accord/accord.config.yaml')
    const before = await readFile(path, 'utf8')
    await writeFile(
      path,
      before.replace(/figma:\n(\s+)enabled: false/, 'figma:\n$1enabled: false\n$1include: []'),
    )
    const data = await getConnections(project)
    expect(data.figma.files).toEqual([])
    expect(data.figma.outside).toContain('figma/app.fig')
    await writeFile(path, before)
  })

  it('switches Figma and Claude Design on without losing comments in the config', async () => {
    await setToolEnabled(project, 'claude_design', true)
    await setToolEnabled(project, 'figma', true)
    const config = await readFile(join(dir, '.accord/accord.config.yaml'), 'utf8')
    expect(config).toContain('# Who owns what.')
    const data = await getConnections(project)
    expect(data.claudeDesign.enabled).toBe(true)
    expect(data.figma.enabled).toBe(true)
    await setToolEnabled(project, 'figma', false)
    expect((await getConnections(project)).figma.enabled).toBe(false)
  })

  it('leaves the config byte-identical after a switch is turned off and on again', async () => {
    const path = join(dir, '.accord/accord.config.yaml')
    const before = await readFile(path, 'utf8')
    const original = before.replace(
      /figma:\n(\s+)enabled: \w+/,
      'figma:\n$1enabled: true\n$1include: ["figma/variables.json"]',
    )
    await writeFile(path, original)
    await setToolEnabled(project, 'figma', false)
    const off = await readFile(path, 'utf8')
    expect(off).toBe(original.replace(/figma:\n(\s+)enabled: true/, 'figma:\n$1enabled: false'))
    await setToolEnabled(project, 'figma', true)
    expect(await readFile(path, 'utf8')).toBe(original)
    await writeFile(path, before)
  })

  it('changes nothing when the switch already has the value', () => {
    const text = 'surfaces:\n  code:\n    include: ["src/**/*.css"]\n  figma:\n    enabled: true # on\n'
    expect(withToolEnabled(text, 'figma', true)).toBe(text)
    expect(withToolEnabled(text, 'pen', false)).toBe(text)
    expect(withToolEnabled(text, 'figma', false)).toBe(text.replace('enabled: true', 'enabled: false'))
    expect(withToolEnabled(text, 'pen', true)).toContain('include: ["src/**/*.css"]')
    expect(withToolEnabled(text, 'pen', true)).toContain('pen:\n    enabled: true')
  })

  it('accepts only the three switchable surfaces', async () => {
    expect(['figma', 'pen', 'claude_design'].every(isToolId)).toBe(true)
    expect(isToolId('code')).toBe(false)
    await expect(setToolEnabled(project, 'code' as never, true)).rejects.toThrow()
  })
})

describe('where Accord looks for code', () => {
  it('reads the fixed folder of a glob', () => {
    expect(globRoot('src/**/*.{ts,tsx,js,jsx,css}')).toBe('src')
    expect(globRoot('**/*.pen')).toBe('')
    expect(globRoot('figma/variables.json')).toBe('figma')
    expect(globRoot('packages/ui/**/*.css')).toBe('packages/ui')
  })

  it('says a glob in plain words', () => {
    expect(describeGlob('src/**/*.{ts,tsx,css}')).toEqual({
      kind: 'files',
      extensions: ['.ts', '.tsx', '.css'],
      root: 'src',
    })
    expect(describeGlob('**/*.figma.json')).toEqual({ kind: 'files', extensions: ['.figma.json'], root: '' })
    expect(describeGlob('figma/variables.json')).toEqual({ kind: 'file', path: 'figma/variables.json' })
    expect(describeGlob('src/*/x?.css')).toBeUndefined()
  })

  it('undoes adding folders: drops exactly their patterns and keeps the old ones', () => {
    const added = suggestInclude(['src/**/*.{ts,tsx,css}'], ['app', 'components'])
    expect(withoutFolders(added, ['app', 'components/'])).toEqual(['src/**/*.{ts,tsx,css}'])
    // Never an empty list: removing the only folder keeps it.
    expect(withoutFolders(['src/**/*.css'], ['src'])).toEqual(['src/**/*.css'])
  })

  it('finds code folders the include patterns miss (shadcn: app/ and components/, not src/)', () => {
    const include = ['src/**/*.{ts,tsx,js,jsx,css}']
    const found = ['app/globals.css', 'components/ui', 'src/styles.css']
    expect(codeOutside(found, include)).toEqual(['app', 'components'])
    expect(codeOutside(found, ['**/*.css'])).toEqual([])
    expect(codeOutside(['src/app/globals.css', 'globals.css'], include)).toEqual([])
    const next = suggestInclude(include, ['app', 'components'])
    expect(next).toEqual([
      'src/**/*.{ts,tsx,js,jsx,css}',
      'app/**/*.{ts,tsx,js,jsx,css}',
      'components/**/*.{ts,tsx,js,jsx,css}',
    ])
    expect(includeYaml(next)).toContain('      - "app/**/*.{ts,tsx,js,jsx,css}"')
  })
})

describe('connections and home texts', () => {
  const keys = (node: unknown, prefix = ''): string[] =>
    typeof node === 'object' && node !== null
      ? Object.entries(node).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
      : [prefix]

  it('are complete in German and English', async () => {
    const de = JSON.parse(await readFile(new URL('../../messages/de.json', import.meta.url), 'utf8'))
    const en = JSON.parse(await readFile(new URL('../../messages/en.json', import.meta.url), 'utf8'))
    for (const ns of ['home', 'connections']) expect(keys(en[ns])).toEqual(keys(de[ns]))
  })

  it('call Pencil by its name, never "Pen"', async () => {
    for (const lang of ['de', 'en']) {
      const text = await readFile(new URL(`../../messages/${lang}.json`, import.meta.url), 'utf8')
      expect(text).not.toMatch(/(?<![.\w{])Pen(?![a-z])/)
    }
  })
})
