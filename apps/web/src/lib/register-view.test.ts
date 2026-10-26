import { fileURLToPath } from 'node:url'
import { cssVariableName } from '@decivo/accord-cli'
import { buildRegister, type Register } from '@decivo/accord-core'
import { loadRegister } from '@decivo/accord-core/node'
import { createTranslator } from 'next-intl'
import { beforeAll, describe, expect, it } from 'vitest'
import de from '../../messages/de.json'
import en from '../../messages/en.json'
import { legacyRegisterHref, readRegisterState, registerHref } from './register-href'
import {
  aliasChain,
  anatomyTree,
  codeUseOf,
  componentRow,
  decisionReason,
  decisionsFor,
  familyOf,
  filterRows,
  leafName,
  missingCss,
  nameInGroup,
  openChangesByToken,
  ownerView,
  previewOf,
  scopeLabel,
  suggestQuery,
  tokenRows,
  valueText,
} from './register-view'

// The app's own register has every token type the screen draws (colours, sizes, fonts, motion, shadows).
const appRegister = fileURLToPath(new URL('../../.accord', import.meta.url))
let register: Register

beforeAll(async () => {
  register = await loadRegister(appRegister)
})

const token = (path: string) => {
  const t = register.tokens.get(path)
  if (!t) throw new Error(`missing ${path}`)
  return t
}

describe('previews', () => {
  it('draws each type the way a design tool would', () => {
    expect(previewOf(token('color.brand.700'))).toMatchObject({ kind: 'color', hex: '#3c6681', alpha: 1 })
    expect(previewOf(token('radius.md'))).toEqual({ kind: 'radius', css: '6px', px: 6 })
    expect(previewOf(token('spacing.md'))).toEqual({ kind: 'length', css: '16px', px: 16 })
    expect(previewOf(token('font.size.lg'))).toMatchObject({ kind: 'fontSize', css: '17px' })
    expect(previewOf(token('font.heading'))).toEqual({
      kind: 'fontFamily',
      css: 'Merriweather, Georgia, Cambria, "Times New Roman", serif',
    })
    expect(previewOf(token('font.weight.light'))).toEqual({ kind: 'fontWeight', weight: 300 })
    expect(previewOf(token('duration.fast'))).toEqual({ kind: 'duration', ms: 120 })
    expect(previewOf(token('easing.standard'))).toEqual({ kind: 'easing', points: [0.2, 0, 0, 1] })
    expect(previewOf(token('shadow.lg'))).toMatchObject({ kind: 'shadow' })
    expect(previewOf(token('layer.toast'))).toEqual({ kind: 'none' })
  })

  it('formats values for people, not as JSON', () => {
    expect(valueText('color', token('color.overlay').value)).toBe('#16222b / 45%')
    expect(valueText('duration', token('duration.slow').value)).toBe('320ms')
    expect(valueText('cubicBezier', token('easing.exit').value)).toBe('cubic-bezier(0.4, 0, 1, 1)')
    expect(valueText('shadow', token('shadow.lg').value)).toBe(
      '0 2px 6px 0 #16222b / 8%, 0 12px 32px 0 #16222b / 16%',
    )
    expect(valueText('fontFamily', token('font.ui').value)).toContain('IBM Plex Sans')
  })

  it('quotes font names with spaces for CSS', () => {
    expect(previewOf(token('font.ui'))).toEqual({
      kind: 'fontFamily',
      css: '"IBM Plex Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
    })
  })
})

describe('names and groups', () => {
  it('groups by the top-level segment and finds scales inside a group', () => {
    expect(nameInGroup('color.ink.$root')).toBe('ink')
    expect(nameInGroup('color.brand.700')).toBe('brand.700')
    expect(familyOf('color.neutral.50')).toBe('neutral')
    expect(familyOf('color.gray-50')).toBe('gray')
    expect(familyOf('color.chart-1')).toBe('chart')
    expect(familyOf('color.primary-foreground')).toBe('')
    expect(familyOf('blue.600')).toBe('')
  })

  it('builds table rows with alias, CSS variable and owner, and merges families of one', () => {
    const rows = tokenRows(register, cssVariableName)
    const ink = rows.find((r) => r.path === 'color.ink.$root')
    expect(ink).toMatchObject({ group: 'color', name: 'ink', cssVar: '--color-ink' })
    expect(rows.find((r) => r.path === 'color.surface.page')).toMatchObject({
      name: 'surface.page',
      alias: 'color.neutral.0',
      cssVar: '--color-surface-page',
    })
    expect(rows.find((r) => r.path === 'color.focus')?.family).toBe('')
    expect(rows.every((r) => r.haystack === r.haystack.toLowerCase())).toBe(true)
  })

  it('searches name, hex without # and CSS variable; every word must match', () => {
    const rows = tokenRows(register, cssVariableName)
    expect(filterRows(rows, '3c6681').map((r) => r.path)).toContain('color.brand.700')
    expect(filterRows(rows, '--radius-md').map((r) => r.path)).toEqual(['radius.md'])
    expect(filterRows(rows, 'brand 700').map((r) => r.path)).toEqual(
      expect.arrayContaining(['color.brand.700', 'color.dark.brand.700']),
    )
    expect(filterRows(rows, 'radius', (r) => r.type === 'color')).toEqual([])
  })
})

describe('inspector facts', () => {
  it('follows alias chains to the token that holds the value', () => {
    expect(aliasChain(register, 'color.on-status')).toEqual(['color.surface.card', 'color.neutral.0'])
    expect(aliasChain(register, 'color.brand.700')).toEqual([])
  })

  it('explains the owner with Accord’s own resolution', () => {
    const view = ownerView(register, 'tokens.color.brand.700')
    expect(view.explain).toMatch(/^tokens\.color\.brand\.700 → /)
    expect(['design', 'code', 'register']).toContain(view.owner)
  })

  it('finds decisions by scope and by name on the token', () => {
    const r = buildRegister([
      { path: 'accord.config.yaml', content: 'version: 1\n' },
      {
        path: 'tokens/c.tokens.json',
        content: JSON.stringify({ color: { $type: 'color', a: { $value: '#ffffff' } } }),
      },
      {
        path: 'decisions/D-001.yaml',
        content: 'id: D-001\nrule: r\nwhy: w\nscope: [tokens.color.**]\nlevel: must\nowner: design\n',
      },
      {
        path: 'decisions/D-002.yaml',
        content: 'id: D-002\nrule: r\nwhy: w\nscope: [code:src/**]\nlevel: should\nowner: code\n',
      },
    ])
    expect(decisionsFor(r, 'tokens.color.a').map((d) => d.id)).toEqual(['D-001'])
    expect(decisionsFor(r, 'tokens.color.a', ['D-002']).map((d) => d.id)).toEqual(['D-001', 'D-002'])
  })

  it('reads the code scan: uses, drift, missing and hard values that should be the token', () => {
    const report = {
      filesScanned: 3,
      tokensCovered: 3,
      missing: ['gray.50'],
      drift: [{ path: 'tokens.radius.card', register: '12px', surface: '10px' }],
      hardValues: [{ file: 'src/Card.tsx', line: 12, raw: '#3c6681', replacement: 'color.brand' }],
      tokenUsage: { 'color.brand': 4 },
    }
    expect(codeUseOf(report, 'color.brand')).toMatchObject({ uses: 4, status: 'used', hardValueCount: 1 })
    expect(codeUseOf(report, 'gray.50')?.status).toBe('missing')
    expect(codeUseOf(report, 'radius.card')).toMatchObject({
      status: 'drift',
      drift: { register: '12px', code: '10px' },
    })
    expect(codeUseOf(report, 'color.text')?.status).toBe('unused')
    expect(codeUseOf({ ...report, filesScanned: 0 }, 'color.text')?.status).toBe('defined')
    expect(codeUseOf({ ...report, filesScanned: 0, tokensCovered: 0 }, 'color.text')).toBeUndefined()
    expect(codeUseOf(undefined, 'color.text')).toBeUndefined()
  })

  it('sums a component up in one line: variant combinations, props and its code file', () => {
    const r = buildRegister([
      { path: 'accord.config.yaml', content: 'version: 1\n' },
      {
        path: 'components/button.yaml',
        content: [
          'name: Button',
          'status: draft',
          'variants: { variant: [default, outline, ghost], size: [sm, lg] }',
          'props: { disabled: { type: boolean } }',
          'mappings: { code: { path: components/ui/button.tsx, export: Button } }',
          '',
        ].join('\n'),
      },
      { path: 'components/separator.yaml', content: 'name: Separator\nstatus: draft\n' },
    ])
    expect(r.issues).toEqual([])
    const button = r.components.get('Button')
    const separator = r.components.get('Separator')
    if (!button || !separator) throw new Error('contracts missing')
    expect(componentRow(button, 'inSync')).toMatchObject({
      variantCount: 6,
      props: 1,
      file: 'components/ui/button.tsx',
    })
    expect(componentRow(separator, 'noMapping')).toMatchObject({ variantCount: 0, props: 0, file: undefined })
  })

  it('nests anatomy under a leading root', () => {
    expect(anatomyTree(['root', 'icon', 'label']).map((p) => p.depth)).toEqual([0, 1, 1])
    expect(anatomyTree(['icon', 'label']).map((p) => p.depth)).toEqual([0, 0])
  })
})

describe('deep links', () => {
  it('round-trips tab, search, filter and selection', () => {
    const href = registerHref('/p/x/register', {
      tab: 'tokens',
      q: ' blue ',
      filter: 'color',
      item: 'blue.600',
    })
    expect(href).toBe('/p/x/register?tab=tokens&q=blue&type=color&token=blue.600')
    const params = Object.fromEntries(new URL(href, 'http://x').searchParams)
    expect(readRegisterState(params)).toEqual({ tab: 'tokens', q: 'blue', filter: 'color', item: 'blue.600' })
    expect(readRegisterState({ tab: 'components', status: 'draft', component: 'Button' })).toEqual({
      tab: 'components',
      q: undefined,
      filter: 'draft',
      item: 'Button',
    })
    expect(readRegisterState({ tab: 'nope' }).tab).toBe('tokens')
    expect(registerHref('/r', { tab: 'rules', filter: 'x', item: 'D-001' })).toBe('/r?tab=rules&rule=D-001')
  })

  it('calls the rules tab "rules": old decision links still open the rule', () => {
    const old = { tab: 'decisions', decision: 'D-002' }
    expect(readRegisterState(old)).toEqual({ tab: 'rules', q: undefined, filter: undefined, item: 'D-002' })
    expect(legacyRegisterHref('/r', old)).toBe('/r?tab=rules&rule=D-002')
    expect(legacyRegisterHref('/r', { tab: 'rules', rule: 'D-002' })).toBeUndefined()
    expect(legacyRegisterHref('/r', { tab: 'tokens' })).toBeUndefined()
  })
})

describe('messages', () => {
  it('names every token type, owner reason and code status in German and English', () => {
    for (const messages of [de, en]) {
      const t = createTranslator({
        locale: 'de',
        messages,
        namespace: 'register',
        onError: (error) => {
          throw error
        },
      })
      const say = (key: string, values?: Record<string, string | number>) =>
        expect(() => t(key as never, values as never)).not.toThrow()
      for (const type of new Set([...register.tokens.values()].map((tk) => tk.type))) say(`types.${type}`)
      for (const key of ['fixed', 'token', 'group', 'component', 'rule', 'default'])
        say(`token.ownerReason.${key}`, { file: 'f', group: 'g', pattern: 'p', index: 1, target: 't' })
      for (const s of ['used', 'unused', 'missing', 'drift', 'defined']) say(`token.codeStatus.${s}`)
    }
  })

  it('has the same register keys in both languages', () => {
    const keys = (o: unknown, prefix = ''): string[] =>
      typeof o === 'object' && o !== null
        ? Object.entries(o).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
        : [prefix]
    expect(keys(en.register).sort()).toEqual(keys(de.register).sort())
  })
})

describe('decision scopes in plain words', () => {
  it('names the usual patterns and keeps the rest as they are', () => {
    expect(scopeLabel('tokens.**')).toEqual({ key: 'allTokens', values: {} })
    expect(scopeLabel('tokens.color.**')).toEqual({ key: 'tokenGroup', values: { group: 'color' } })
    expect(scopeLabel('code:src/**/*.{ts,tsx,js,jsx,css}')).toEqual({
      key: 'codeDir',
      values: { dir: 'src/' },
    })
    expect(scopeLabel('code:**/*.css')).toEqual({ key: 'allCode', values: {} })
    expect(scopeLabel('components.*.props.**')).toEqual({
      key: 'raw',
      values: { pattern: 'components.*.props.**' },
    })
  })

  it('says why a decision applies to a token', () => {
    const d = { id: 'D-002', scope: ['tokens.**'] }
    expect(decisionReason(d, 'tokens.radius.card')).toEqual({ kind: 'pattern', pattern: 'tokens.**' })
    expect(decisionReason(d, 'tokens.radius.card', ['D-002'])).toEqual({ kind: 'named' })
    expect(decisionReason({ id: 'D-1', scope: ['code:src/**'] }, 'tokens.radius.card')).toBeUndefined()
  })
})

describe('open proposals per token', () => {
  it('keeps open, decidable proposals and groups them by token', () => {
    const change = (token: string) => ({ token, kind: 'change' as const, before: '1px', after: '2px' })
    const open = openChangesByToken([
      { id: 'P-1', tool: 'figma', group: 'needsYou', decidable: true, changes: [change('radius.card')] },
      {
        id: 'P-2',
        tool: 'pen',
        group: 'auto',
        decidable: true,
        changes: [change('radius.card'), change('a')],
      },
      { id: 'P-3', tool: 'figma', group: 'decided', decidable: true, changes: [change('b')] },
      { id: 'P-4', tool: 'code', group: 'code', decidable: false, changes: [change('c')] },
    ])
    expect(Object.keys(open).sort()).toEqual(['a', 'radius.card'])
    expect(open['radius.card']?.map((o) => o.id)).toEqual(['P-1', 'P-2'])
    expect(open['radius.card']?.[0]).toMatchObject({ tool: 'figma', kind: 'change', after: '2px' })
  })
})

describe('CSS for tokens that code does not have yet', () => {
  it('names each variable the way Accord reads it back, with a value CSS understands', () => {
    const css = missingCss(
      register,
      ['color.brand.700', 'radius.md', 'nope', 'color.surface.page'],
      cssVariableName,
    )
    expect(css).toBe(
      [
        ':root {',
        '  --color-brand-700: #3c6681;',
        '  --radius-md: 6px;',
        '  --color-surface-page: var(--color-neutral-0);',
        '}',
      ].join('\n'),
    )
  })

  it('has nothing to copy without a known token', () => {
    expect(missingCss(register, ['nope'], cssVariableName)).toBeUndefined()
  })
})

describe('token names in the tree', () => {
  it('drops the family from a leaf, as Figma lists 50 … 900 inside a group', () => {
    expect(leafName('secondary-50', 'secondary')).toBe('50')
    expect(leafName('neutral.0', 'neutral')).toBe('0')
    expect(leafName('background-muted', '')).toBe('background-muted')
    expect(leafName('secondary', 'secondary')).toBe('secondary')
    expect(leafName('sidebar-ring', 'gray')).toBe('sidebar-ring')
  })
})

describe('a search that finds nothing', () => {
  const rows = [{ haystack: 'color.primary #034592 --color-primary' }, { haystack: 'color.border #eee' }]
  it('suggests the register word for an everyday one (brand → primary)', () => {
    expect(suggestQuery(rows, 'brand')).toBe('primary')
    expect(suggestQuery(rows, ' Rahmen ')).toBe('border')
  })
  it('suggests nothing when the search finds something or no synonym exists here', () => {
    expect(suggestQuery(rows, 'primary')).toBeUndefined()
    expect(suggestQuery(rows, 'erfolg')).toBeUndefined()
    expect(suggestQuery(rows, 'xyz')).toBeUndefined()
    expect(suggestQuery(rows, '')).toBeUndefined()
  })
})
