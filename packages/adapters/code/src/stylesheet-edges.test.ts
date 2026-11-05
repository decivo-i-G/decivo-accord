import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCssVariables, resolveCssVariables } from './css-vars.js'
import { scanStylesheet, stylesheetError } from './hard-values.js'
import { readStylesheets } from './stylesheets.js'

describe('stylesheets: edge cases from the review', () => {
  it('flags named colours where a colour is expected, not keywords elsewhere', () => {
    const found = scanStylesheet(
      '.a { color: red; border: 1px solid RebeccaPurple; display: block; color: currentColor; }\n.b { transition: color 1s; color-scheme: light dark; }\n',
      'a.css',
    )
    expect(found.map((f) => f.raw)).toEqual(['red', 'RebeccaPurple'])
  })

  it('places a colour in a value spanning lines at its own line and column', () => {
    const css = '.a {\n  box-shadow:\n    0 0 0 1px #3c6681,\n    0 2px 4px #16222b;\n}\n'
    const found = scanStylesheet(css, 'a.css')
    expect(found.map((f) => [f.raw, f.line, f.column])).toEqual([
      ['#3c6681', 3, 15],
      ['#16222b', 4, 15],
    ])
  })

  it('keeps an !important variable over a later one without it, as browsers do', () => {
    const vars = parseCssVariables(
      ':root { --brand: #3c6681 !important; }\n:root { --brand: #ff0000; }\n',
      'a.css',
    )
    expect(resolveCssVariables(vars).get('--brand')?.resolved).toBe('#3c6681')
  })

  it('names a broken stylesheet instead of failing, and still finds its plain colours', async () => {
    const css = '.broken { color: #3c6681 '
    expect(stylesheetError(css, 'b.css')).toMatch(/Unclosed block/)
    expect(scanStylesheet(css, 'b.css').map((f) => f.raw)).toEqual(['#3c6681'])
    const root = await mkdtemp(join(tmpdir(), 'accord-broken-css-'))
    await writeFile(join(root, 'b.css'), css)
    const sheets = await readStylesheets(root, ['b.css'])
    expect(sheets.variables).toEqual([])
    expect(sheets.skipped).toEqual([expect.objectContaining({ import: 'b.css', reason: 'unparsable' })])
  })
})
