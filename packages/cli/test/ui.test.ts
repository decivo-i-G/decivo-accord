import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findUiBin, npxCommand, uiArgs } from '../src/ui.js'

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
    expect(findUiBin([join(project, 'package.json')], '1.0.0')).toBeUndefined()
    const pkg = join(project, 'node_modules', '@decivo', 'accord-ui')
    mkdirSync(join(pkg, 'dist'), { recursive: true })
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({
        name: '@decivo/accord-ui',
        version: '1.0.0',
        exports: { '.': './dist/index.js', './package.json': './package.json' },
      }),
    )
    writeFileSync(join(pkg, 'dist', 'bin.js'), '')
    expect(findUiBin([join(project, 'package.json')], '1.0.0')).toBe(join(pkg, 'dist', 'bin.js'))
    // Another version is not used.
    expect(findUiBin([join(project, 'package.json')], '2.0.0')).toBeUndefined()
  })

  it('runs npx through node without a shell where npm sits next to node', () => {
    const win = npxCommand(
      'C:\\node\\node.exe',
      'win32',
      (p) => p.endsWith('npx-cli.js') && p.includes('node_modules'),
    )
    expect(win).toMatchObject({ cmd: 'C:\\node\\node.exe', shell: false })
    expect(win.pre[0]).toMatch(/npx-cli\.js$/)
    expect(npxCommand('/x/node', 'win32', () => false)).toEqual({ cmd: 'npx.cmd', pre: [], shell: true })
    expect(npxCommand('/x/node', 'linux', () => false)).toEqual({ cmd: 'npx', pre: [], shell: false })
  })
})
