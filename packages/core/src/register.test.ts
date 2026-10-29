import { describe, expect, it } from 'vitest'
import { buildRegister, type RegisterFile, registerPaths } from './register.js'

const config = (extra = '') => ({ path: 'accord.config.yaml', content: `version: 1\n${extra}` })
const colorTokens: RegisterFile = {
  path: 'tokens/color.tokens.json',
  content: JSON.stringify({
    color: {
      $type: 'color',
      brand: { '700': { $value: { colorSpace: 'srgb', components: [0.2353, 0.4, 0.5059], hex: '#3c6681' } } },
    },
  }),
}
const decision = (yaml: string, path = 'decisions/D-004.yaml'): RegisterFile => ({ path, content: yaml })
const codes = (files: RegisterFile[]) => buildRegister(files).issues.map((i) => i.code)

const D004 = `id: D-004
rule: Brand colours only from the brand scale
why: Recognisable blue.
scope: [tokens.color.**]
level: must
owner: design
checks:
  - question: Does the change introduce a colour outside the brand scale?
    type: yes_no
    block_threshold: 0.7
`

describe('buildRegister', () => {
  it('fills config defaults', () => {
    const register = buildRegister([config()])
    expect(register.issues).toEqual([])
    expect(register.config.ownership.default).toBe('register')
    expect(register.config.routing.auto_apply).toEqual({ low: 0.85, medium: 0.95 })
    expect(register.config.surfaces.code.enabled).toBe(true)
    expect(register.config.outputs.design_md).toBe('DESIGN.md')
  })

  it('reads the language of the register text, and rejects what is no language tag', () => {
    expect(buildRegister([config()]).config.language).toBeUndefined()
    expect(buildRegister([config('language: de\n')]).config.language).toBe('de')
    expect(buildRegister([config('language: de-AT\n')]).config.language).toBe('de-AT')
    expect(buildRegister([config('language: Deutsch und so\n')]).issues.length).toBeGreaterThan(0)
  })

  it('only accepts output paths inside the project', () => {
    expect(buildRegister([config('outputs:\n  agents_md: docs/AGENTS.md\n')]).issues).toEqual([])
    for (const path of ['../../.bashrc', '/etc/x', 'docs/../../x.md', 'C:\\\\x.md'])
      expect(
        buildRegister([config(`outputs:\n  claude_md: "${path}"\n`)]).issues.length,
        path,
      ).toBeGreaterThan(0)
    const css = 'surfaces:\n  code:\n    outputs:\n      - { format: css, path: ../x.css }\n'
    expect(buildRegister([config(css)]).issues.length).toBeGreaterThan(0)
  })

  it('reports a missing config', () => {
    expect(codes([])).toContain('missing-config')
  })

  it('reads the decision format from the brief', () => {
    const register = buildRegister([config(), colorTokens, decision(D004)])
    expect(register.issues).toEqual([])
    expect(register.decisions.get('D-004')).toMatchObject({
      level: 'must',
      status: 'active',
      checks: [{ type: 'yes_no', block_threshold: 0.7 }],
    })
  })

  it('validates decision fields', () => {
    const bad = decision('id: 4\nrule: x\nwhy: y\nscope: [color.*]\nlevel: maybe\nowner: design\n')
    const issues = buildRegister([config(), bad]).issues
    expect(issues.map((i) => i.path).sort()).toEqual(['id', 'level', 'scope.0'])
  })

  it('hints when a single * scope only matches one level', () => {
    const shallow = decision(D004.replace('tokens.color.**', 'tokens.color.*'))
    const issue = buildRegister([config(), colorTokens, shallow]).issues.find(
      (i) => i.code === 'pattern-matches-nothing',
    )
    expect(issue?.message).toContain('did you mean tokens.color.**')
  })

  it('rejects contracts that use unknown tokens and duplicate names', () => {
    const button = (path: string) => ({ path, content: 'name: Button\ntokens: [color.brand.900]\n' })
    expect(codes([config(), colorTokens, button('components/a.yaml'), button('components/b.yaml')])).toEqual([
      'duplicate-component',
      'unknown-token',
    ])
  })

  it('rejects token references to unknown decisions and unknown supersedes', () => {
    const tokens: RegisterFile = {
      path: 'tokens/n.tokens.json',
      content: JSON.stringify({
        n: { $type: 'number', $value: 1, $extensions: { 'de.decivo.accord': { decisions: ['D-999'] } } },
      }),
    }
    const superseding = decision(`${D004}supersedes: [D-001]\n`)
    expect(codes([config(), colorTokens, tokens, superseding]).sort()).toEqual([
      'unknown-decision',
      'unknown-decision',
    ])
  })

  it('lists component fields as register paths', () => {
    const register = buildRegister([
      config(),
      {
        path: 'components/button.yaml',
        content: 'name: Button\nvariants: { size: [sm, md] }\nprops: { disabled: { type: boolean } }\n',
      },
    ])
    expect(registerPaths(register)).toEqual([
      'components.Button',
      'components.Button.variants',
      'components.Button.props',
      'components.Button.states',
      'components.Button.slots',
      'components.Button.variants.size',
      'components.Button.props.disabled',
    ])
  })
})
