import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseLock } from '@decivo/accord-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { initCommand, penCommand } from '../src/commands.js'
import { translator } from '../src/messages.js'

const fixture = fileURLToPath(new URL('./fixtures/shop', import.meta.url))
const t = translator('de')

// The shop's brand colour is #487a98; the Pencil file has drifted to #4a7b9a and uses one colour directly.
const PEN = `{
  // pen.dev document
  "themes": { "mode": ["light", "dark"] },
  "variables": {
    "color.brand.$root": { "type": "color", "value": "#4a7b9a" },
    "color.text": { "type": "color", "value": [{ "value": "#16222b" }, { "value": "#f5f7f9", "theme": { "mode": "dark" } }] }
  },
  "children": [{ "id": "cta", "type": "rectangle", "fill": "#ff00aa" }]
}`

describe('accord pen', () => {
  let root = ''
  const run = async (action: 'status' | 'lock' | 'propose', json = false) => {
    const out: string[] = []
    const code = await penCommand({ root, register: '.accord', action, json }, t, (s) => out.push(s))
    return { code, out: out.join('\n') }
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'accord-pen-'))
    await cp(fixture, root, { recursive: true })
    await writeFile(join(root, 'design', 'landing.pen'), PEN)
    await initCommand({ root, register: '.accord', force: false, dryRun: false }, t, () => {})
  })
  afterAll(() => rm(root, { recursive: true, force: true }))

  it('init switches the Pencil surface on when it finds .pen files', async () => {
    expect(await readFile(join(root, '.accord', 'accord.config.yaml'), 'utf8')).toMatch(
      /pen:\n\s+enabled: true/,
    )
  })

  it('status shows the drifted value, the hard-coded colour and the theme values; exit 1 on drift', async () => {
    const { code, out } = await run('status')
    expect(code).toBe(1)
    expect(out).toContain('Pencil (1 Datei(en)')
    expect(out).toMatch(/tokens\.color\.brand\.\$root .*#487a98 → #4a7b9a/)
    expect(out).toContain('#ff00aa ×1  cta')
    expect(out).toContain('1 Token(s) mit Theme-Werten')
  })

  it('propose: without a last sync nobody knows who changed the colour, so a person decides', async () => {
    const { code, out } = await run('propose', true)
    expect(code).toBe(1)
    const proposal = JSON.parse(out)
    expect(proposal).toMatchObject({ source: 'pen', route: 'owner' })
    expect(proposal.reasons[0].code).toBe('conflict')
    expect(proposal.changes).toEqual([
      expect.objectContaining({ token: 'color.brand.$root', after: '#4a7b9a', origin: 'unknown' }),
    ])
  })

  it('lock records the Pencil state; afterwards the same drift counts as changed in Pencil', async () => {
    const before = await run('status')
    expect(before.out).toContain('noch kein Abgleich')
    expect((await run('lock')).out).toContain('Stand von Pencil gespeichert')
    const lock = parseLock(await readFile(join(root, '.accord', 'surfaces.lock.json'), 'utf8'))
    expect(lock.surfaces.pen?.snapshot.tokens).toBeDefined()
    // Locked as it is now, so Pencil and lock agree: only a register change could show up.
    const after = await run('status')
    expect(after.out).toContain('im Register geändert, Pencil nicht nachgezogen')
  })

  it('--json lists files, items and literals without the snapshot', async () => {
    const { out } = await run('status', true)
    const json = JSON.parse(out)
    expect(json.files).toEqual(['design/landing.pen'])
    expect(json.literals[0]).toMatchObject({ value: '#ff00aa', count: 1 })
    expect(json.snapshot).toBeUndefined()
  })
})
