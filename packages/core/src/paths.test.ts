import { describe, expect, it } from 'vitest'
import { compareSpecificity, matchPath } from './paths.js'

describe('matchPath', () => {
  it.each([
    ['tokens.color.*', 'tokens.color.brand', true],
    ['tokens.color.*', 'tokens.color.brand.700', false],
    ['tokens.color.**', 'tokens.color.brand.700', true],
    ['tokens.color.**', 'tokens.color', true],
    ['tokens.**.700', 'tokens.color.brand.700', true],
    ['tokens.color.brand-*', 'tokens.color.brand-700', true],
    ['tokens.color.brand-*', 'tokens.color.neutral-700', false],
    ['components.*.props.**', 'components.Button.props.disabled', true],
    ['components.*.props.**', 'components.Button.variants.size', false],
    ['tokens.color.brand.700', 'tokens.color.brand.700', true],
    ['**', 'anything.at.all', true],
  ])('%s vs %s → %s', (pattern, path, expected) => {
    expect(matchPath(pattern, path)).toBe(expected)
  })

  it('treats dots in patterns as separators, not regex wildcards', () => {
    expect(matchPath('tokens.a-b', 'tokens.aXb')).toBe(false)
  })
})

describe('compareSpecificity', () => {
  it('ranks literal segments above wildcards', () => {
    expect(compareSpecificity('tokens.color.brand.700', 'tokens.color.**')).toBeGreaterThan(0)
    expect(compareSpecificity('tokens.color.*', 'tokens.color.**')).toBeGreaterThan(0)
    expect(compareSpecificity('tokens.**', 'tokens.color.**')).toBeLessThan(0)
    expect(compareSpecificity('tokens.color.*', 'tokens.color.*')).toBe(0)
  })
})
