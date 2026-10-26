import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildRegister,
  cssToColor,
  emptyLock,
  type RegisterFile,
  resolverDocument,
  restrictTo,
  snapshotFromRegister,
  withLockedSnapshot,
} from '@decivo/accord-core'
import { gzipSync, strToU8, zipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readHandoff, unpackBundledHtml } from './bundle.js'
import { designSystemStatus, readDesignSystemMirror, resetPlan } from './design-system.js'
import { analyseHandoff, pageLiterals } from './literals.js'

const files: RegisterFile[] = [
  { path: 'accord.config.yaml', content: 'version: 1\n' },
  {
    path: 'tokens/all.tokens.json',
    content: JSON.stringify({
      color: {
        $type: 'color',
        brand: { '600': { $value: cssToColor('#487a98') }, '700': { $value: cssToColor('#3c6681') } },
      },
      spacing: { $type: 'dimension', lg: { $value: { value: 24, unit: 'px' } } },
    }),
  },
]
const register = buildRegister(files)

const PAGE = `<!DOCTYPE html>
<html><body><x-dc>
<helmet><style>
a{color:#3C6681}
</style></helmet>
<div style="display:{{ L.display }};background:#4a7d9b;padding:24px">
  <p style="color:#487A98">Hallo</p>
</div>
</x-dc>
<script type="text/x-dc">
class Component extends DCLogic { renderVals() { return { chip: 'color: #9A4A06; background: #FBEBDD' } } }
</script>
</body></html>`

describe('pageLiterals', () => {
  it('reads colours from style attributes, style blocks and logic scripts with their line', () => {
    const found = pageLiterals({ path: 'page.dc.html', html: PAGE })
    expect(found.map((v) => `${v.line} ${v.raw}`)).toEqual([
      '4 #3C6681',
      '6 #4a7d9b',
      '7 #487A98',
      '11 #9A4A06',
      '11 #FBEBDD',
    ])
  })
})

describe('readHandoff', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'accord-cd-'))
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('reads a handoff zip and the primary page from its README', async () => {
    const zip = zipSync({
      'shop/README.md': strToU8('Read `shop/project/Home.dc.html` in full.'),
      'shop/project/Home.dc.html': strToU8(PAGE),
      'shop/project/screenshots/01.html': strToU8('<p style="color:red">ignored</p>'),
      'shop/project/assets/logo.png': new Uint8Array([1, 2, 3]),
    })
    const path = join(dir, 'Shop-handoff.zip')
    await writeFile(path, zip)
    const bundle = await readHandoff(path)
    expect(bundle).toMatchObject({ name: 'Shop', primary: 'shop/project/Home.dc.html', styles: [] })
    expect(bundle.pages.map((p) => p.path)).toEqual(['shop/project/Home.dc.html'])
  })

  it('unpacks single-file exports with a bundler manifest', () => {
    const page = `<html><script type="__bundler/template">${JSON.stringify('<title>Vorschläge</title><p style="color:#487a98">x</p>')}</script></html>`
    const manifest = {
      abc: {
        mime: 'text/html',
        compressed: true,
        data: Buffer.from(gzipSync(strToU8(page))).toString('base64'),
      },
    }
    const html = `<script type="__bundler/manifest">${JSON.stringify(manifest)}</script><script type="__bundler/page_order">["abc"]</script>`
    expect(unpackBundledHtml(html, 'proto.html')).toEqual([
      {
        path: 'proto.html#abc',
        title: 'Vorschläge',
        html: '<title>Vorschläge</title><p style="color:#487a98">x</p>',
      },
    ])
  })
})

describe('analyseHandoff', () => {
  it('groups colours and maps them to tokens, flagging near misses', () => {
    const { colors } = analyseHandoff({ name: 'x', pages: [{ path: 'p', html: PAGE }], styles: [] }, register)
    expect(colors.map((c) => [c.value, c.exact[0] ?? null, c.near?.path ?? null])).toEqual([
      ['#3c6681', 'color.brand.700', null],
      ['#487a98', 'color.brand.600', null],
      ['#4a7d9b', null, 'color.brand.600'],
      ['#9a4a06', null, null],
      ['#fbebdd', null, null],
    ])
  })
})

describe('design-system project', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'accord-ds-'))
    await writeFile(
      join(dir, 'colors_and_type.css'),
      ':root {\n  --color-brand-600: #487a98;\n  --spacing-lg: 28px; /* edited in Claude Design */\n}\n',
    )
    await writeFile(
      join(dir, 'button.html'),
      '<!-- @dsCard group="Buttons" --><style>.b{background:var(--color-brand-600)}</style>',
    )
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('finds the spacing edited without a proposal and plans the reset', async () => {
    const mirror = await readDesignSystemMirror(dir)
    const base = restrictTo(snapshotFromRegister(register), {
      tokens: ['color.brand.600', 'spacing.lg'],
      components: [],
    })
    const lock = withLockedSnapshot(emptyLock(), 'claude-design', base, new Date('2026-10-01T00:00:00Z'))
    const status = designSystemStatus(mirror, register, lock)
    expect(status.items).toMatchObject([
      { origin: 'surface', op: { kind: 'token.value_changed', path: 'tokens.spacing.lg' } },
    ])
    expect(status.missing).toEqual(['color.brand.700'])

    const plan = resetPlan(mirror, register, status)
    expect(plan.skipped).toEqual([])
    expect(plan.files).toEqual([
      {
        path: 'colors_and_type.css',
        content:
          ':root {\n  --color-brand-600: #487a98;\n  --spacing-lg: 24px; /* edited in Claude Design */\n}\n',
        changes: [{ variable: '--spacing-lg', from: '28px', to: '24px' }],
      },
    ])
  })
})

describe('design-system project with light and dark', () => {
  const modal = buildRegister([
    { path: 'accord.config.yaml', content: 'version: 1\n' },
    {
      path: 'tokens/all.tokens.json',
      content: JSON.stringify({
        color: {
          $type: 'color',
          background: { $value: cssToColor('#ffffff') },
          foreground: { $value: cssToColor('#111111') },
          muted: { $value: cssToColor('#eeeeee') },
        },
      }),
    },
    {
      path: 'modes/theme/dark.tokens.json',
      content: JSON.stringify({
        color: {
          background: { $value: cssToColor('#000000') },
          foreground: { $value: cssToColor('#fafafa') },
          muted: { $value: cssToColor('#222222') },
        },
      }),
    },
    {
      path: 'resolver.json',
      content: JSON.stringify(
        resolverDocument({
          tokenFiles: ['tokens/all.tokens.json'],
          contexts: ['light', 'dark'],
          default: 'light',
          files: new Map([['dark', 'modes/theme/dark.tokens.json']]),
        }),
      ),
    },
  ])
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'accord-ds-modes-'))
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  const mirrorWith = async (name: string, css: string) => {
    const path = join(dir, name)
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'colors_and_type.css'), css)
    return readDesignSystemMirror(path)
  }

  it('compares the dark block and resets only the value in its context', async () => {
    const mirror = await mirrorWith(
      'edited',
      ':root {\n  --color-background: #ffffff;\n  --color-foreground: #111111;\n  --color-muted: #eeeeee;\n}\n' +
        '.dark {\n  --color-background: #000000;\n  --color-foreground: #cccccc;\n  --color-muted: #222222;\n}\n',
    )
    const status = designSystemStatus(mirror, modal, emptyLock())
    expect(status.contexts).toEqual(['dark'])
    expect(status.items).toMatchObject([
      { op: { kind: 'token.value_changed', path: 'tokens.color.foreground', context: { theme: 'dark' } } },
    ])

    const plan = resetPlan(mirror, modal, status)
    expect(plan.files).toHaveLength(1)
    expect(plan.files[0]?.changes).toEqual([
      { variable: '--color-foreground', from: '#cccccc', to: '#fafafa', context: 'dark' },
    ])
    // The light value with the same name stays untouched.
    expect(plan.files[0]?.content).toContain('--color-foreground: #111111;')
    expect(plan.files[0]?.content).toContain('--color-foreground: #fafafa;')
  })

  it('adds a dark value the project falls back for to its dark block', async () => {
    const mirror = await mirrorWith(
      'missing',
      ':root { --color-background: #ffffff; --color-foreground: #111111; --color-muted: #eeeeee; }\n' +
        '[data-theme="dark"] { --color-background: #000000; --color-foreground: #fafafa; }\n',
    )
    const status = designSystemStatus(mirror, modal, emptyLock())
    expect(status.selectors).toMatchObject([
      { context: 'dark', selector: '[data-theme="dark"]', how: 'detected' },
    ])
    expect(status.items).toMatchObject([
      { op: { path: 'tokens.color.muted', context: { theme: 'dark' }, fallback: 'after' } },
    ])
    const plan = resetPlan(mirror, modal, status)
    expect(plan.files[0]?.changes).toEqual([{ variable: '--color-muted', to: '#222222', context: 'dark' }])
    expect(plan.files[0]?.content).toMatch(/\[data-theme="dark"\] \{[^}]*--color-muted: #222222/)
  })

  it('compares only the default context when the project has no dark block', async () => {
    const mirror = await mirrorWith('light-only', ':root { --color-background: #ffffff; }\n')
    const status = designSystemStatus(mirror, modal, emptyLock())
    expect(status.contexts).toEqual([])
    expect(status.items).toEqual([])
  })
})
