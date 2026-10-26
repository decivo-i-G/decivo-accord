import { describe, expect, it } from 'vitest'
import { parseCssVariables, resolveCssVariables } from './css-vars.js'
import { countTokenUses, countVariableUsage } from './usage.js'

describe('countVariableUsage', () => {
  const vars = resolveCssVariables(
    parseCssVariables(
      ':root { --brand-700: #3c6681; --chart-1: #487a98; } @theme inline { --color-primary: var(--brand-700); }',
      'g.css',
    ),
  )

  it('counts var() and Tailwind utilities, and credits the variables an alias points to', () => {
    const usage = countVariableUsage(
      [
        `<a className="text-primary hover:bg-primary/80 border-primary-foreground" style={{ color: 'var(--brand-700)' }} />`,
        `.x { fill: var(--color-primary); }`,
      ],
      vars,
    )
    expect(usage.get('--color-primary')).toBe(3)
    expect(usage.get('--brand-700')).toBe(4)
    expect(usage.get('--chart-1')).toBe(0)
  })
  it('counts each usage site once for adoption', () => {
    const sources = ['<a className="text-primary" style={{ color: "var(--brand-700)" }} />']
    expect(countTokenUses(sources, vars, new Set(['--brand-700', '--color-primary']))).toBe(2)
    expect(countTokenUses(sources, vars, new Set(['--brand-700']))).toBe(2)
    expect(countTokenUses(sources, vars, new Set(['--chart-1']))).toBe(0)
  })
})
