import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  buildRegister,
  emptyLock,
  type RegisterFile,
  restrictTo,
  snapshotFromRegister,
  withLockedSnapshot,
} from '@decivo/accord-core'
import { describe, expect, it } from 'vitest'
import { parsePen, penStatus, readPenFiles } from './pen.js'

const fixtures = fileURLToPath(new URL('../test/fixtures', import.meta.url))
const hex = (h: string) => ({ colorSpace: 'srgb', components: [0, 0, 0], hex: h })

const files: RegisterFile[] = [
  { path: 'accord.config.yaml', content: 'version: 1\n' },
  {
    path: 'tokens/color.tokens.json',
    content: JSON.stringify({
      color: {
        $type: 'color',
        brand: { $root: { $value: hex('#487a98') } },
        text: { $value: hex('#16222b') },
        border: { $value: hex('#dde3e8') },
      },
      radius: { md: { $type: 'dimension', $value: { value: 8, unit: 'px' } } },
    }),
  },
]
const register = buildRegister(files)

describe('Pencil (.pen)', () => {
  it('reads variables under the default theme and keeps the other theme values', async () => {
    const doc = parsePen(await readFile(`${fixtures}/landing.pen`, 'utf8'), 'landing.pen')
    expect(doc.errors).toEqual([])
    expect(doc.themes).toEqual({ mode: ['light', 'dark'] })
    const text = doc.variables.find((v) => v.name === 'color.text')
    expect(text?.value).toBe('#16222b')
    expect(text?.themed).toEqual([{ theme: { mode: 'dark' }, value: '#f5f7f9' }])
    // References are resolved.
    expect(doc.variables.find((v) => v.name === 'primary')?.value).toBe('#4a7b9a')
  })

  it('finds colours set directly on nodes, case-insensitively, with node ids', async () => {
    const doc = parsePen(await readFile(`${fixtures}/landing.pen`, 'utf8'), 'landing.pen')
    expect(doc.literals).toEqual([
      { value: '#ff00aa', count: 2, nodes: ['cta', 'badge'], files: ['landing.pen'] },
    ])
  })

  it('compares with the register by register path, ids.pen or CSS variable name', async () => {
    const status = penStatus(await readPenFiles(fixtures), register, emptyLock())
    expect(status.items.map((i) => `${i.op.kind} ${i.op.path} ${i.origin}`)).toEqual([
      'token.value_changed tokens.color.brand.$root unknown',
    ])
    // radius.md is matched through its CSS variable name (radius-md) and is in sync (8 → 8px).
    expect(status.snapshot.tokens.has('radius.md')).toBe(true)
    expect(status.missing).toEqual(['color.border'])
    expect(status.unmapped.map((v) => v.name).sort()).toEqual(['hero-glow', 'primary'])
    expect(status.themed).toEqual([
      { path: 'color.text', themed: [{ theme: { mode: 'dark' }, value: '#f5f7f9' }] },
    ])
  })

  it('after a lock, a change in Pencil is drift from the surface, a register change is not', async () => {
    // `pen lock` stores what Pencil covers; here: those tokens as the register has them.
    const docs = await readPenFiles(fixtures)
    const covered = penStatus(docs, register, emptyLock()).snapshot.coverage
    const synced = withLockedSnapshot(
      emptyLock(),
      'pen',
      restrictTo(snapshotFromRegister(register), covered),
      new Date(),
    )
    const status = penStatus(docs, register, synced)
    expect(status.items.map((i) => i.origin)).toEqual(['surface'])
  })

  it('reports unreadable documents instead of throwing', () => {
    expect(parsePen('{ kaputt', 'x.pen').errors).toEqual(['x.pen: not a readable .pen document'])
    expect(parsePen('[]', 'y.pen').errors).toHaveLength(1)
  })
})
