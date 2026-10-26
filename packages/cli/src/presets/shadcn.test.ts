import { ComponentSchema } from '@decivo/accord-core'
import { describe, expect, it } from 'vitest'
import { applyPreset, SHADCN_PRESETS } from './shadcn.js'

describe('shadcn presets', () => {
  it('cover the ten MVP components and are valid contracts', () => {
    expect(Object.keys(SHADCN_PRESETS).sort()).toEqual([
      'Badge',
      'Button',
      'Card',
      'Checkbox',
      'Dialog',
      'Input',
      'Label',
      'Select',
      'Table',
      'Tabs',
    ])
    for (const [name, preset] of Object.entries(SHADCN_PRESETS)) {
      expect(ComponentSchema.safeParse({ name, ...preset }).success).toBe(true)
    }
  })

  it('leaves unknown components alone', () => {
    expect(applyPreset({ name: 'HeroTransform' })).toEqual({ name: 'HeroTransform' })
  })
})
