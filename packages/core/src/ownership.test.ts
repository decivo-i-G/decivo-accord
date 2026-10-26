import { describe, expect, it } from 'vitest'
import { explainOwner, resolveOwner } from './ownership.js'
import { buildRegister, type RegisterFile } from './register.js'

const color = (hex: string) => ({ colorSpace: 'srgb', components: [0, 0, 0], hex })

const files = (configRules: string, tokens: object, components: RegisterFile[] = []): RegisterFile[] => [
  {
    path: 'accord.config.yaml',
    content: `version: 1\nownership:\n  default: register\n  rules:\n${configRules}`,
  },
  { path: 'tokens/all.tokens.json', content: JSON.stringify(tokens) },
  ...components,
]

const RULES = `    - { match: tokens.color.**, owner: design }
    - { match: tokens.color.focus.**, owner: code }
    - { match: components.*.props.**, owner: code }
    - { match: components.*.variants.**, owner: design }
`

const TOKENS = {
  color: {
    $type: 'color',
    brand: { '600': { $value: color('#487a98') } },
    focus: { ring: { $value: color('#5b9bb8') } },
    status: {
      $extensions: { 'de.decivo.accord': { owner: 'register' } },
      error: { $value: color('#b42318') },
      info: { $value: color('#3c6681'), $extensions: { 'de.decivo.accord': { owner: 'code' } } },
    },
  },
  radius: { $type: 'dimension', md: { $value: { value: 8, unit: 'px' } } },
}

const BUTTON: RegisterFile = {
  path: 'components/button.yaml',
  content: `name: Button
variants: { variant: [primary, ghost] }
props: { disabled: { type: boolean }, asChild: { type: boolean } }
owners: { props.asChild: register }
`,
}

const register = buildRegister(files(RULES, TOKENS, [BUTTON]))
const owner = (path: string) => resolveOwner(register, path)

describe('resolveOwner', () => {
  it('builds a valid register for the scenarios below', () => {
    expect(register.issues).toEqual([])
  })

  it('uses the most specific config rule', () => {
    expect(owner('tokens.color.brand.600')).toEqual({
      owner: 'design',
      source: { kind: 'rule', pattern: 'tokens.color.**', index: 0 },
    })
    expect(owner('tokens.color.focus.ring').owner).toBe('code')
  })

  it('prefers a group exception over rules, and a token exception over the group', () => {
    expect(owner('tokens.color.status.error')).toMatchObject({
      owner: 'register',
      source: { kind: 'group', path: 'color.status' },
    })
    expect(owner('tokens.color.status.info')).toMatchObject({ owner: 'code', source: { kind: 'token' } })
  })

  it('falls back to the default', () => {
    expect(owner('tokens.radius.md')).toEqual({ owner: 'register', source: { kind: 'default' } })
  })

  it('resolves component fields by field type, with per-component exceptions', () => {
    expect(owner('components.Button.props.disabled').owner).toBe('code')
    expect(owner('components.Button.variants.variant').owner).toBe('design')
    expect(owner('components.Button.props.asChild')).toMatchObject({
      owner: 'register',
      source: { kind: 'component' },
    })
  })

  it('resolves paths that do not exist yet (new tokens proposed by a surface)', () => {
    expect(owner('tokens.color.brand.650').owner).toBe('design')
    expect(owner('tokens.color.status.warning').owner).toBe('register')
  })

  it('keeps names, additions, deletions and deprecations with the register', () => {
    for (const aspect of ['name', 'existence', 'deprecation'] as const) {
      expect(resolveOwner(register, 'tokens.color.brand.600', aspect).owner).toBe('register')
    }
  })

  it('keeps decisions with the register even if a rule says otherwise', () => {
    expect(owner('decisions.D-004').owner).toBe('register')
  })

  it('explains where the owner comes from', () => {
    expect(explainOwner(register, 'tokens.color.focus.ring')).toBe(
      'tokens.color.focus.ring → code (ownership rule #2 "tokens.color.focus.**" in accord.config.yaml)',
    )
    expect(explainOwner(register, 'tokens.color.status.info')).toBe(
      'tokens.color.status.info → code ($extensions on the token in tokens/all.tokens.json)',
    )
  })
})

describe('lintOwnership', () => {
  const codes = (rules: string, tokens: object = TOKENS) =>
    buildRegister(files(rules, tokens)).issues.map((i) => i.code)

  it('rejects rules that hand decisions to someone else', () => {
    expect(codes('    - { match: decisions.**, owner: design }\n')).toContain('ownership-fixed')
  })

  it('rejects the same pattern with two owners', () => {
    expect(
      codes(
        '    - { match: tokens.color.**, owner: design }\n    - { match: tokens.color.**, owner: code }\n',
      ),
    ).toContain('ownership-conflict')
  })

  it('warns when more than 20 % of tokens are exceptions', () => {
    const many: Record<string, object> = {}
    for (let i = 0; i < 10; i++) {
      many[`c${i}`] = {
        $value: color('#000000'),
        ...(i < 3 ? { $extensions: { 'de.decivo.accord': { owner: 'code' } } } : {}),
      }
    }
    expect(
      codes('    - { match: tokens.**, owner: design }\n', { color: { $type: 'color', ...many } }),
    ).toContain('ownership-exceptions')
  })
})
