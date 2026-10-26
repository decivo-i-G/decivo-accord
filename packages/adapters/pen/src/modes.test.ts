import { buildRegister, cssToColor, emptyLock, type RegisterFile } from '@decivo/accord-core'
import { describe, expect, it } from 'vitest'
import { parsePen, penStatus } from './pen.js'

const pen = (dark: string) => `{
  // pen.dev library with a light/dark theme axis
  "themes": { "mode": ["light", "dark"], "density": ["regular", "compact"] },
  "variables": {
    "--color-background": { "type": "color", "value": [{ "value": "#ffffff" }, { "value": "${dark}", "theme": { "mode": "dark" } }] },
    "--gap": { "type": "number", "value": [{ "value": 16 }, { "value": 8, "theme": { "density": "compact" } }] }
  },
  "children": []
}`

const files: RegisterFile[] = [
  { path: 'accord.config.yaml', content: 'version: 1\n' },
  {
    path: 'tokens/color.tokens.json',
    content: JSON.stringify({
      color: { $type: 'color', background: { $value: cssToColor('#ffffff') } },
      gap: { $type: 'dimension', $value: { value: 16, unit: 'px' } },
    }),
  },
  {
    path: 'modes/theme/dark.tokens.json',
    content: JSON.stringify({ color: { background: { $value: cssToColor('#0a0a0a') } } }),
  },
  {
    path: 'resolver.json',
    content: JSON.stringify({
      version: '2025.10',
      sets: { core: { sources: [{ $ref: 'tokens/color.tokens.json' }] } },
      modifiers: {
        theme: {
          contexts: { light: [], dark: [{ $ref: 'modes/theme/dark.tokens.json' }] },
          default: 'light',
        },
      },
      resolutionOrder: [{ $ref: '#/sets/core' }, { $ref: '#/modifiers/theme' }],
    }),
  },
]

describe('Pencil themes as register contexts', () => {
  const register = buildRegister(files)

  it('compares mode: dark with the dark context; density is no context', () => {
    expect(register.issues).toEqual([])
    const inSync = penStatus([parsePen(pen('#0a0a0a'), 'library.pen')], register, emptyLock())
    expect(inSync.contexts).toEqual(['dark'])
    expect(inSync.items).toEqual([])
    const changed = penStatus([parsePen(pen('#1f2937'), 'library.pen')], register, emptyLock())
    expect(changed.items).toEqual([
      expect.objectContaining({
        op: expect.objectContaining({ path: 'tokens.color.background', context: { theme: 'dark' } }),
        origin: 'unknown',
      }),
    ])
    expect(changed.themed.find((t) => t.path === 'gap')?.themed).toEqual([
      { theme: { density: 'compact' }, value: 8 },
    ])
  })
})
