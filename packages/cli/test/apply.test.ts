import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ApplyError, planApply, type Resolution, ResolutionSchema } from '../src/apply.js'
import type { HandoffProposal } from '../src/claude-design.js'
import { applyCommand, exportCommand, initCommand } from '../src/commands.js'
import { translator } from '../src/messages.js'

const fixture = fileURLToPath(new URL('./fixtures/shop', import.meta.url))
const t = translator('de')

const proposal: HandoffProposal = {
  id: 'P-20261018-landing',
  source: 'claude-design',
  bundle: { name: 'Landing', pages: ['Landing'] },
  createdAt: '2026-10-18T10:00:00.000Z',
  route: 'owner',
  decider: 'design',
  colors: { inRegister: [], nearMisses: [], new: [] },
  violations: [],
}

const resolution = (extra: Partial<Resolution> = {}): Resolution => ({
  schema: 'accord.resolution/1',
  proposal: proposal.id,
  option: 'adopt',
  items: [{ token: 'color.brand.$root', value: '#4a7b9a', kind: 'change' }],
  by: 'Janni',
  at: '2026-10-18T14:00:00Z',
  ref: 'review:123',
  ...extra,
})

const CONTRAST = `id: D-009
rule: Text bleibt auf Markenflächen lesbar
why: Unter 4,5:1 ist Text für viele Menschen nicht lesbar.
scope: [tokens.color.**]
level: must
owner: register
checks:
  - type: deterministic
    rule: { kind: min_contrast, ratio: 4.5, foreground: tokens.color.text, background: tokens.color.brand.700 }
`

describe('accord apply', () => {
  let root = ''
  let outside = ''
  const register = () => join(root, '.accord')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const read = (path: string) => readFile(join(root, path), 'utf8')
  const apply = async (r: unknown, extra: { dryRun?: boolean; branch?: boolean } = {}) => {
    const file = join(outside, 'resolution.json')
    await writeFile(file, JSON.stringify(r))
    const out: string[] = []
    const code = await applyCommand(
      {
        root,
        register: '.accord',
        resolution: file,
        dryRun: extra.dryRun ?? false,
        branch: extra.branch ?? false,
        push: false,
        json: false,
      },
      t,
      (s) => out.push(s),
    )
    return { code, out: out.join('\n') }
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'accord-apply-'))
    outside = await mkdtemp(join(tmpdir(), 'accord-resolution-'))
    await cp(fixture, root, { recursive: true })
    await initCommand({ root, register: '.accord', force: false, dryRun: false }, t, () => {})
    await exportCommand({ root, register: '.accord', check: false }, t, () => {})
    await mkdir(join(register(), 'proposals'), { recursive: true })
    await writeFile(join(register(), 'proposals', `${proposal.id}.json`), JSON.stringify(proposal, null, 2))
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@accord.local')
    git('config', 'user.name', 'Accord Test')
    git('add', '.')
    git('commit', '-qm', 'init')
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it('adopt changes the token, regenerates the outputs and records the decision', async () => {
    const tokensBefore = await read('.accord/tokens/color.tokens.json')
    const { code, out } = await apply(resolution())
    expect(code).toBe(0)
    expect(out).toContain('color.brand.$root: #487a98 → #4a7b9a')

    const tokens = await read('.accord/tokens/color.tokens.json')
    expect(JSON.parse(tokens).color.brand.$root.$value.hex).toBe('#4a7b9a')
    // Only the value changed (three components and the hex), not the formatting of the file.
    const changed = tokens.split('\n').filter((line, i) => line !== tokensBefore.split('\n')[i])
    expect(changed.map((l) => l.trim())).toEqual(['0.2902,', '0.4824,', '0.6039', '"hex": "#4a7b9a"'])

    expect(await read('.accord/generated/DESIGN.md')).toContain('#4a7b9a')
    // The changelog already lists this decision.
    expect(await read('.accord/generated/CHANGELOG.md')).toContain(
      '**Adopted** `P-20261018-landing` "Landing" (claude-design), decided by Janni (review:123)',
    )
    const saved = JSON.parse(await read(`.accord/proposals/${proposal.id}.json`))
    expect(saved.resolution).toEqual({
      option: 'adopt',
      items: [{ token: 'color.brand.$root', value: '#4a7b9a', kind: 'change' }],
      by: 'Janni',
      at: '2026-10-18T14:00:00Z',
      ref: 'review:123',
    })
  })

  it('a decided new colour passes "colours only from the register" (D-002): the decision is the new colour', async () => {
    expect(await read('.accord/decisions/D-002.yaml')).toContain('value_in_scale')
    const { code } = await apply(
      resolution({
        items: [{ token: 'color.brand.600', value: '#4a7d9b', kind: 'new', description: 'Hero' }],
      }),
    )
    expect(code).toBe(0)
    const tokens = JSON.parse(await read('.accord/tokens/color.tokens.json'))
    expect(tokens.color.brand['600'].$value.hex).toBe('#4a7d9b')
    expect(tokens.color.brand['600'].$description).toBe('Hero')
  })

  it('refuses an adoption that breaks another must rule, and writes nothing', async () => {
    await writeFile(join(register(), 'decisions', 'D-009.yaml'), CONTRAST)
    const before = git('status', '--porcelain')
    const { code, out } = await apply(
      resolution({ items: [{ token: 'color.text', value: '#2a3d4c', kind: 'change' }] }),
    )
    expect(code).toBe(1)
    expect(out).toContain('Muss-Regel')
    expect(out).toContain('D-009')
    expect(git('status', '--porcelain')).toBe(before)
  })

  it('reset and reject leave the register alone and only record the decision', async () => {
    const { code, out } = await apply(resolution({ option: 'reset', items: [] }))
    expect(code).toBe(0)
    expect(out).toContain('Das Register bleibt unverändert.')
    // Besides the decision on the proposal, only the changelog is new.
    expect(
      git('status', '--porcelain')
        .split('\n')
        .map((l) => l.trim())
        .sort(),
    ).toEqual(['?? .accord/generated/CHANGELOG.md', 'M .accord/proposals/P-20261018-landing.json'])
    expect(await read('.accord/generated/CHANGELOG.md')).toContain('**Reset to the register**')
  })

  it('a decided proposal cannot be decided again', async () => {
    expect((await apply(resolution({ option: 'reject', items: [] }))).code).toBe(0)
    const again = await apply(resolution())
    expect(again.code).toBe(1)
    expect(again.out).toContain('Schon entschieden')
  })

  it('dry run shows the change and writes nothing', async () => {
    const { code, out } = await apply(resolution(), { dryRun: true })
    expect(code).toBe(0)
    expect(out).toContain('Probelauf')
    expect(git('status', '--porcelain')).toBe('')
  })

  it('with --branch it commits on accord/apply-<id>, never on main', async () => {
    const { code, out } = await apply(resolution(), { branch: true })
    expect(code).toBe(0)
    expect(out).toContain('accord/apply-p-20261018-landing')
    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('accord/apply-p-20261018-landing')
    expect(git('log', '-1', '--format=%s')).toBe(
      'accord: adopt P-20261018-landing – decided by Janni (review:123)',
    )
    expect(git('log', '-1', '--format=%b')).toContain('color.brand.$root: #487a98 -> #4a7b9a')
    expect(git('log', 'main', '-1', '--format=%s')).toBe('init')
    expect(git('status', '--porcelain')).toBe('')
  })

  it.each([
    [{ ...resolution(), items: [] }, 'adopt needs at least one item'],
    [{ ...resolution(), option: 'reset' }, 'reset and reject take none'],
    [{ ...resolution(), schema: 'accord.resolution/2' }, 'schema'],
    [{ ...resolution(), at: 'gestern' }, 'at'],
  ])('rejects an invalid decision %#', async (r, message) => {
    const { code, out } = await apply(r)
    expect(code).toBe(1)
    expect(out).toContain('Die Entscheidung ist ungültig')
    expect(out).toContain(message)
  })

  it('names unknown proposals, unknown tokens and values that are no colour', async () => {
    const cases: [Resolution, ApplyError['code']][] = [
      [resolution({ proposal: 'P-unbekannt' }), 'not_found'],
      [
        resolution({ items: [{ token: 'color.gibtsnicht', value: '#000000', kind: 'change' }] }),
        'invalid_edit',
      ],
      [resolution({ items: [{ token: 'color.brand.700', value: '#000000', kind: 'new' }] }), 'invalid_edit'],
      [resolution({ items: [{ token: 'color.text', value: 'blaugrau', kind: 'change' }] }), 'invalid_value'],
    ]
    for (const [r, code] of cases) {
      const error = await planApply({
        root,
        registerDir: register(),
        resolution: ResolutionSchema.parse(r),
      }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ApplyError)
      expect((error as ApplyError).code).toBe(code)
    }
  })
})
