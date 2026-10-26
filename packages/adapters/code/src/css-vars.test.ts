import { describe, expect, it } from 'vitest'
import { parseCssVariables, resolveCssVariables } from './css-vars.js'

const CSS = `
:root { --brand: #487a98; --primary: var(--brand); --ring: var(--missing, var(--brand)); --broken: var(--nope); }
.dark { --brand: #5a9bb8; }
@media (max-width: 767px) { :root { --brand: #000; } }
@theme inline { --color-primary: var(--primary); }
`

describe('css variables', () => {
  const vars = parseCssVariables(CSS, 'globals.css')

  it('records scope and context', () => {
    expect(vars.map((v) => [v.name, v.scope])).toEqual([
      ['--brand', 'base'],
      ['--primary', 'base'],
      ['--ring', 'base'],
      ['--broken', 'base'],
      ['--brand', '.dark'],
      ['--brand', '@media (max-width: 767px)'],
      ['--color-primary', 'base'],
    ])
    expect(vars.at(-1)?.context).toBe('@theme inline')
  })

  it('resolves references, fallbacks and @theme in the base scope', () => {
    const base = resolveCssVariables(vars)
    expect(base.get('--color-primary')).toMatchObject({ resolved: '#487a98', references: ['--primary'] })
    expect(base.get('--ring')?.resolved).toBe('#487a98')
    expect(base.get('--broken')?.resolved).toBeUndefined()
  })

  it('lets a named scope override base values', () => {
    expect(resolveCssVariables(vars, '.dark').get('--color-primary')?.resolved).toBe('#5a9bb8')
  })
})
