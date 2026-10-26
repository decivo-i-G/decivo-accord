import { buildRegister, cssToColor, resolverDocument, type Token } from '@decivo/accord-core'
import { describe, expect, it } from 'vitest'
import { contextView, modeValue, modeView } from './register-modes'

const token = (path: string, type: Token['type']) => ({ path, type }) as Token
const tokens = new Map([
  ['color.brand', token('color.brand', 'color')],
  ['color.text', token('color.text', 'color')],
  ['radius.card', token('radius.card', 'dimension')],
])

describe('modeValue', () => {
  it('draws a CSS colour as hex with a swatch colour', () => {
    expect(modeValue(token('color.brand', 'color'), '#2F5A74')).toEqual({
      text: '#2f5a74',
      color: expect.stringMatching(/./),
    })
  })

  it('reads numbers in the token type', () => {
    expect(modeValue(token('radius.card', 'dimension'), 12)).toEqual({ text: '12px' })
    expect(modeValue(token('motion.fast', 'duration'), 120)).toEqual({ text: '120ms' })
  })
})

describe('modeView', () => {
  const status = {
    modes: ['Light', 'Dark'],
    defaultMode: 'Light',
    themed: [
      { path: 'color.brand', themed: [{ theme: { mode: 'Dark' }, value: '#2f5a74' }] },
      { path: 'color.gone', themed: [{ theme: { mode: 'Dark' }, value: '#000000' }] },
    ],
    snapshot: {
      tokens: new Map([
        ['color.brand', {}],
        ['color.text', {}],
      ]),
    },
  }

  it('keeps the main mode, lists the others and their differing values', () => {
    const view = modeView(status, { tokens })
    expect(view?.source).toBe('figma')
    expect(view?.main).toBe('Light')
    expect(view?.others).toEqual(['Dark'])
    expect(view?.covered).toEqual(['color.brand', 'color.text'])
    expect(view?.values['color.brand']?.Dark?.text).toBe('#2f5a74')
    // Tokens the register no longer has are left out; same values are not listed.
    expect(view?.values['color.gone']).toBeUndefined()
    expect(view?.values['color.text']).toBeUndefined()
  })

  it('is undefined with a single mode', () => {
    expect(modeView({ ...status, modes: ['Light'] }, { tokens })).toBeUndefined()
    expect(modeView({ ...status, modes: [], defaultMode: undefined }, { tokens })).toBeUndefined()
  })
})

describe('contextView', () => {
  const register = (withModes: boolean) =>
    buildRegister([
      { path: 'accord.config.yaml', content: 'version: 1\n' },
      {
        path: 'tokens/all.tokens.json',
        content: JSON.stringify({
          color: {
            $type: 'color',
            background: { $value: cssToColor('#ffffff') },
            foreground: { $value: cssToColor('#111111') },
            text: { $value: '{color.foreground}' },
            brand: { $value: cssToColor('#487a98') },
          },
        }),
      },
      ...(withModes
        ? [
            {
              path: 'modes/theme/dark.tokens.json',
              content: JSON.stringify({
                color: {
                  background: { $value: cssToColor('#000000') },
                  foreground: { $value: cssToColor('#fafafa') },
                },
              }),
            },
            {
              path: 'resolver.json',
              content: JSON.stringify(
                resolverDocument({
                  tokenFiles: ['tokens/all.tokens.json'],
                  contexts: ['light', 'dark'],
                  default: 'light',
                  files: new Map([['dark', 'modes/theme/dark.tokens.json']]),
                }),
              ),
            },
          ]
        : []),
    ])

  it("shows the register's own dark values, including aliases that resolve differently", () => {
    const view = contextView(register(true))
    expect(view).toMatchObject({ source: 'register', main: 'light', others: ['dark'] })
    expect(view?.values['color.background']?.dark?.text).toBe('#000000')
    expect(view?.values['color.text']?.dark?.text).toBe('#fafafa')
    // A token dark does not set and that resolves the same stays empty: „wie Hell“.
    expect(view?.values['color.brand']).toBeUndefined()
    expect(view?.covered).toContain('color.brand')
  })

  it('is undefined for a register without modes', () => {
    expect(contextView(register(false))).toBeUndefined()
  })
})
