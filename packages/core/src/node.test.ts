import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadRegister, readRegisterFiles } from './node.js'

const fixture = fileURLToPath(new URL('../test/fixtures/basic/.accord', import.meta.url))

describe('loadRegister', () => {
  it('loads a register from disk and skips generated files', async () => {
    const files = await readRegisterFiles(fixture)
    expect(files.map((f) => f.path)).toEqual([
      'accord.config.yaml',
      'components/button.yaml',
      'decisions/D-004.yaml',
      'decisions/D-007.yaml',
      'tokens/color.tokens.json',
      'tokens/spacing.tokens.json',
    ])
    const register = await loadRegister(fixture)
    expect(register.issues).toEqual([])
    expect(register.tokens.size).toBe(5)
    expect(register.components.get('Button')?.variants.variant).toEqual(['primary', 'secondary', 'ghost'])
    expect([...register.decisions.keys()]).toEqual(['D-004', 'D-007'])
  })
})
