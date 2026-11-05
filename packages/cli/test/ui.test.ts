import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findUiBin, uiArgs } from '../src/ui.js'

describe('accord ui', () => {
  it('passes the folders (default: --root), the port and --no-open on', () => {
    expect(uiArgs({ root: '.', folders: [], open: true })).toEqual([resolve('.')])
    expect(uiArgs({ root: '.', folders: ['a', 'b'], port: 4400, open: false })).toEqual([
      resolve('a'),
      resolve('b'),
      '--port',
      '4400',
      '--no-open',
    ])
  })

  it('finds @decivo/accord-ui installed in the project, and nothing where it is not', () => {
    const project = realpathSync(mkdtempSync(join(tmpdir(), 'accord-ui-bin-')))
    writeFileSync(join(project, 'package.json'), '{}')
    expect(findUiBin([join(project, 'package.json')])).toBeUndefined()
    const pkg = join(project, 'node_modules', '@decivo', 'accord-ui')
    mkdirSync(join(pkg, 'dist'), { recursive: true })
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({
        name: '@decivo/accord-ui',
        exports: { '.': './dist/index.js', './package.json': './package.json' },
      }),
    )
    writeFileSync(join(pkg, 'dist', 'bin.js'), '')
    expect(findUiBin([join(project, 'package.json')])).toBe(join(pkg, 'dist', 'bin.js'))
  })
})
