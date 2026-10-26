import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ingestHandoff,
  initCommand,
  type SurfaceProposal,
  saveProposal,
  translator,
} from '@decivo/accord-cli'
import { loadRegister } from '@decivo/accord-core/node'
import { strToU8, zipSync } from 'fflate'
import { createTranslator } from 'next-intl'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import de from '../../messages/de.json'
import en from '../../messages/en.json'
import { adoptPreview, decideProposal, undoDecision } from './decide'
import { aliasesOf, impactOf, usesOf } from './impact'
import type { Project } from './projects'
import {
  decisionCopyOf,
  effortOf,
  inboxCounts,
  isOpen,
  loadInbox,
  type ProposalView,
  parseStoredProposal,
  recommendationOf,
} from './proposals'

const fixture = fileURLToPath(new URL('../../../../packages/cli/test/fixtures/shop', import.meta.url))

const radius: SurfaceProposal = {
  id: 'P-20261013-figma-radius',
  source: 'figma',
  createdAt: '2026-10-13T09:00:00.000Z',
  route: 'auto',
  reasons: [{ code: 'safe' }],
  changes: [
    {
      token: 'radius.md',
      kind: 'change',
      type: 'dimension',
      before: '0.5rem',
      after: '0.75rem',
      origin: 'surface',
      owner: 'design',
    },
  ],
  violations: [],
}

const deletion: SurfaceProposal = {
  id: 'P-20261014-pen-delete',
  source: 'pen',
  createdAt: '2026-10-14T09:00:00.000Z',
  route: 'owner',
  decider: 'register',
  reasons: [
    { code: 'breaking', at: 'tokens.color.brand.700' },
    { code: 'deletion', at: 'tokens.color.brand.700' },
  ],
  changes: [
    {
      token: 'color.brand.700',
      kind: 'remove',
      type: 'color',
      before: '#3c6681',
      origin: 'surface',
      owner: 'register',
    },
  ],
  violations: [],
}

describe('proposals inbox', () => {
  let dir: string
  let project: Project
  const proposalsDir = () => join(dir, '.accord', 'proposals')

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'accord-web-'))
    await cp(fixture, dir, { recursive: true })
    await initCommand(
      { root: dir, register: '.accord', force: false, dryRun: false },
      translator('de'),
      () => {},
    )
    const bundle = join(dir, 'Landing-handoff.zip')
    await writeFile(
      bundle,
      zipSync({
        'landing/project/Landing.dc.html': strToU8(
          '<div style="background:#4a7d9b;color:#d81b60;border-color:#d81b60">x</div>',
        ),
      }),
    )
    const proposal = await ingestHandoff({
      root: dir,
      registerDir: join(dir, '.accord'),
      bundle,
      now: new Date('2026-10-12T10:00:00Z'),
    })
    await saveProposal(proposal, { root: dir, registerDir: join(dir, '.accord'), branch: false })
    await mkdir(proposalsDir(), { recursive: true })
    for (const p of [radius, deletion])
      await writeFile(join(proposalsDir(), `${p.id}.json`), `${JSON.stringify(p, null, 2)}\n`)
    // Files the inbox must survive: broken JSON, an unknown source, and a newer Figma format.
    await writeFile(join(proposalsDir(), 'P-broken.json'), '{ "id": ')
    await writeFile(join(proposalsDir(), 'P-other.json'), JSON.stringify({ id: 'P-other', source: 'sketch' }))
    await writeFile(
      join(proposalsDir(), 'P-20261015-figma-future.json'),
      JSON.stringify({
        id: 'P-20261015-figma-future',
        source: 'figma',
        route: 'someday',
        reasons: 'not a list',
        changes: [
          { token: 'radius.md', kind: 'rename', to: 'radius.medium' },
          { token: 'radius.lg', kind: 'new', type: 'dimension', after: '1rem', owner: 'nobody' },
        ],
      }),
    )
    project = { slug: 'shop', name: 'shop', root: dir, branch: 'main' }
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('reads Figma/Pencil and handoff proposals, groups them and skips what it cannot read', async () => {
    const { proposals, unreadable } = await loadInbox(project)
    expect(unreadable.sort()).toEqual(['P-broken.json', 'P-other.json'])
    const byId = new Map(proposals.map((p) => [p.id, p]))
    expect(byId.get('P-20261012-landing')).toMatchObject({
      kind: 'handoff',
      tool: 'claude-design',
      group: 'needsYou',
      decidable: true,
    })
    expect(byId.get(radius.id)).toMatchObject({
      kind: 'surface',
      tool: 'figma',
      group: 'auto',
      title: { key: 'title.change', values: { token: 'radius.md' } },
      summary: { key: 'summary.change', values: { before: '0.5rem', after: '0.75rem' } },
      why: { key: 'why.safe' },
    })
    expect(byId.get(deletion.id)).toMatchObject({
      tool: 'pen',
      group: 'needsYou',
      why: { key: 'why.deletion', values: { who: 'register', at: 'color.brand.700' } },
      risk: { deletion: true, breaking: true },
    })
    // Unknown change kinds are dropped, an unknown route goes to a person, an unknown owner to the register.
    expect(byId.get('P-20261015-figma-future')).toMatchObject({
      group: 'needsYou',
      route: 'owner',
      changes: [{ token: 'radius.lg', kind: 'new', owner: 'register' }],
    })
    // Inbox order: needs you, goes through on its own, decided.
    const groups = proposals.map((p) => p.group)
    expect(groups.indexOf('auto')).toBeGreaterThan(groups.lastIndexOf('needsYou'))
  })

  it('maps a handoff onto register tokens and names the rule it breaks', async () => {
    const { proposals } = await loadInbox(project)
    const handoff = proposals.find((p) => p.id === 'P-20261012-landing') as ProposalView
    expect(handoff.colors.find((c) => c.value === '#4a7d9b')).toMatchObject({
      match: 'near',
      token: 'color.brand.$root',
      tokenValue: '#487a98',
    })
    expect(handoff.colors.find((c) => c.value === '#d81b60')).toMatchObject({ match: 'new', count: 2 })
    expect(handoff.rules.map((r) => r.decision)).toContain('D-002')
    // The sentence leads with the fact: the draft brings new shades, and new colours are Design's call.
    expect(handoff.why).toMatchObject({ key: 'why.newShades', values: { count: 1, decision: 'D-002' } })
    // Near misses carry their distance, and zero counts stay out of the row summary.
    expect(handoff.colors.find((c) => c.value === '#4a7d9b')?.distance).toBeGreaterThan(0)
    expect(handoff.summary).toMatchObject({ key: 'summary.handoffBoth', values: { near: 1, fresh: 1 } })
  })

  it('suggests exactly one option for every open proposal, and keeps the register where it weighs more', async () => {
    const { proposals } = await loadInbox(project)
    const byId = new Map(proposals.map((p) => [p.id, p]))
    const get = (id: string) => byId.get(id) as ProposalView
    expect(recommendationOf(get(radius.id))).toMatchObject({
      option: 'adopt',
      reason: { key: 'recommend.safe' },
    })
    expect(recommendationOf(get('P-20261012-landing'))).toMatchObject({
      option: 'reset',
      reason: { key: 'recommend.handoffNear', values: { near: 1 } },
    })
    // A deletion says plainly what disappears and suggests keeping it, scanned code or not.
    expect(recommendationOf(get(deletion.id), 3)).toMatchObject({
      option: 'reset',
      reason: { key: 'recommend.deletion', values: { uses: 3, scanned: 'yes', who: 'register', count: 1 } },
    })
    expect(recommendationOf(get(deletion.id))).toMatchObject({
      option: 'reset',
      reason: { key: 'recommend.deletion', values: { scanned: 'no' } },
    })
    expect(String(recommendationOf(get(deletion.id))?.reason.values?.tokens)).toContain('color.brand.700')
    // Every open proposal that is decided here gets one suggestion, so there is always one primary button.
    for (const p of proposals.filter((p) => isOpen(p) && p.decidable))
      expect(recommendationOf(p), p.id).toBeDefined()
    expect(recommendationOf({ ...get(radius.id), decision: { option: 'adopt' } })).toBeUndefined()
    // Hard values in code are not decided here: their own group, outside progress and badge.
    expect(isOpen({ group: 'code' })).toBe(false)
    expect(isOpen({ group: 'auto' })).toBe(true)
  })

  it('names each button by its outcome, and keeps the opposite apart from ignoring', async () => {
    const { proposals } = await loadInbox(project)
    const get = (id: string) => proposals.find((p) => p.id === id) as ProposalView
    const t = createTranslator({ locale: 'de', messages: de, namespace: 'proposals' })
    const say = (m: { key: string; values?: Record<string, string | number> }) =>
      (t as unknown as (k: string, v?: Record<string, string | number>) => string)(m.key, m.values)
    // A value change: keep the register value or adopt the new one, both named.
    const change = decisionCopyOf(get(radius.id))
    expect(say(change.label.reset)).toBe('0.5rem behalten')
    expect(say(change.label.adopt)).toBe('0.75rem übernehmen')
    expect(say(change.effect.reset)).toContain('Figma')
    // Aliases move with the token, and the adopt consequence names them before the click.
    expect(say(change.effect.adopt)).toBe('radius.md wird 0.75rem in Register, CSS und CHANGELOG.')
    expect(say(decisionCopyOf(get(radius.id), ['radius.card']).effect.adopt)).toBe(
      'radius.md und damit radius.card werden 0.75rem in Register, CSS und CHANGELOG.',
    )
    // A deletion: keep the token, or delete it after one more question.
    const del = decisionCopyOf(get(deletion.id))
    expect(say(del.label.reset)).toBe('color.brand.700 behalten')
    expect(say(del.label.adopt)).toBe('color.brand.700 löschen …')
    // Ignoring is its own outcome: nothing changes and nobody gets a task.
    expect(say(change.effect.reject)).not.toBe(say(change.effect.reset))
    expect(say(change.label.reject)).toBe('Ignorieren')
    // A handoff adopts nothing unless colours are named, and says what happens to its close colours.
    const handoff = decisionCopyOf(get('P-20261012-landing'))
    expect(say(handoff.label.reset)).toBe('Nichts übernehmen')
    expect(say(handoff.effect.reset)).toContain('Claude Design')
  })

  it('opens quick decisions first: one token, then deletions, then handoffs', async () => {
    const { proposals } = await loadInbox(project)
    const open = proposals.filter((p) => p.group === 'needsYou')
    const efforts = open.map(effortOf)
    expect(efforts).toEqual([...efforts].sort((a, b) => a - b))
    expect(
      effortOf({ kind: 'handoff', changes: [], risk: { deletion: false, breaking: false, conflict: false } }),
    ).toBe(3)
  })

  it('counts the inbox once, for the sidebar badge, the inbox header and Home alike', async () => {
    const { proposals } = await loadInbox(project)
    const counts = inboxCounts(proposals)
    const by = (g: ProposalView['group']) => proposals.filter((p) => p.group === g).length
    expect(counts).toEqual({
      needsYou: by('needsYou'),
      auto: by('auto'),
      code: by('code'),
      decided: by('decided'),
      open: by('needsYou') + by('auto'),
    })
    expect(counts.needsYou + counts.auto + counts.code + counts.decided).toBe(proposals.length)
    expect(counts.open).toBe(proposals.filter(isOpen).length)
  })

  it('tells new shades from mere transparencies in a handoff', async () => {
    const file = join(proposalsDir(), 'P-20261020-alpha.json')
    await writeFile(
      file,
      JSON.stringify({
        id: 'P-20261020-alpha',
        source: 'claude-design',
        route: 'owner',
        decider: 'design',
        violations: [
          { decision: 'D-002', level: 'must', rule: 'Colours from the register', value: '#d81b60' },
        ],
        bundle: { name: 'alpha', pages: [] },
        colors: {
          inRegister: [],
          nearMisses: [],
          new: [{ value: '#d81b60' }, { value: '#00000014' }, { value: 'rgba(0, 0, 0, 0.08)' }],
        },
      }),
    )
    try {
      const { proposals } = await loadInbox(project)
      const alpha = proposals.find((p) => p.id === 'P-20261020-alpha') as ProposalView
      expect(alpha.why).toMatchObject({ key: 'why.newShadesSplit', values: { shades: 1, alpha: 2 } })
      const text = createTranslator({ locale: 'de', messages: de, namespace: 'proposals' })
      expect(text('why.newShadesSplit', alpha.why.values as never)).toContain(
        '3 neue Farben mit (ein Farbton, 2 Transparenzen)',
      )
    } finally {
      await rm(file, { force: true })
    }
  })

  it('shows what else a change moves: aliases, uses in code and contrast', () => {
    const color = (hex: string, aliasOf?: string) => {
      const n = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16) / 255
      return { type: 'color', aliasOf, value: { colorSpace: 'srgb', components: [n(1), n(3), n(5)], hex } }
    }
    const register = {
      tokens: new Map(
        Object.entries({
          'blue.600': color('#3c6681'),
          'gray.50': color('#f5f7f9'),
          'color.brand': color('#3c6681', 'blue.600'),
          'color.link': color('#3c6681', 'color.brand'),
          'color.surface': color('#f5f7f9', 'gray.50'),
        }).map(([path, t]) => [path, { path, ...t }]),
      ),
    } as never
    expect(aliasesOf(register, 'blue.600')).toEqual(['color.brand', 'color.link'])
    expect(usesOf(register, ['blue.600'], { 'blue.600': 1, 'color.link': 2, 'gray.50': 9 })).toBe(3)
    const impact = impactOf(
      register,
      { token: 'blue.600', type: 'color', before: '#3c6681', after: '#2a5d7c' },
      { scanned: true, usage: { 'color.brand': 4 } },
    )
    expect(impact).toMatchObject({ aliases: ['color.brand', 'color.link'], uses: 4 })
    expect(impact.contrast?.token).toBe('color.surface')
    expect(impact.contrast?.after).toBeGreaterThan(impact.contrast?.before ?? Infinity)
    expect(impactOf(register, { token: 'blue.600', type: 'color' }, { scanned: false }).uses).toBeUndefined()
  })

  it('parses leniently and refuses what is not a proposal', () => {
    expect(parseStoredProposal(null)).toBeUndefined()
    expect(parseStoredProposal({ id: 'nope', source: 'figma', changes: [] })).toBeUndefined()
    expect(parseStoredProposal({ id: 'P-1', source: 'claude-design' })).toMatchObject({
      colors: { inRegister: [], nearMisses: [], new: [] },
      route: 'owner',
    })
  })

  it('renders every text of every proposal in German and English', async () => {
    const { proposals } = await loadInbox(project)
    for (const messages of [de, en]) {
      const t = createTranslator({
        locale: 'de',
        messages,
        namespace: 'proposals',
        onError: (error) => {
          throw error
        },
      })
      const say = (key: string, values?: Record<string, string | number>) =>
        (t as unknown as (k: string, v?: Record<string, string | number>) => string)(key, values)
      for (const p of proposals) {
        for (const m of [p.title, p.summary, p.why])
          expect(say(m.key, m.values), m.key).not.toContain('proposals.')
        say(`tool.${p.tool}`)
        if (p.kind !== 'code') {
          // Every button names its outcome and says what it leads to, before the click.
          const copy = decisionCopyOf(p)
          for (const option of ['adopt', 'reset', 'reject'] as const) {
            expect(say(copy.label[option].key, copy.label[option].values), option).not.toContain('proposals.')
            expect(say(copy.effect[option].key, copy.effect[option].values), option).not.toContain(
              'proposals.',
            )
          }
        }
        for (const near of [0, 1, 10]) say('effectShort.resetHandoff', { near })
        say(`state.${p.group}`)
        say(`group.${p.group}`)
        say(`groupHint.${p.group}`)
        for (const r of [recommendationOf(p, 2), recommendationOf(p, 0), recommendationOf(p)]) {
          if (!r) continue
          const sentence = say(r.reason.key, r.reason.values)
          expect(sentence, r.reason.key).not.toContain('proposals.')
          // Rules go by their name in the sentence; their codes stay in the details.
          expect(sentence, r.reason.key).not.toMatch(/\bD-\d{3}\b/)
          say('actions.recommended')
        }
        expect(say(p.why.key, p.why.values), p.why.key).not.toMatch(/\bD-\d{3}\b/)
        for (const scanned of ['yes', 'no'])
          for (const uses of [0, 1, 4])
            say('actions.confirmDeletionText', { tokens: 'spacing.4', scanned, uses })
        say('effectShort.adoptDeletion', { tokens: 'spacing.4' })
        say('effectShort.adoptWithDeletion', {
          tokens: 'spacing.4',
          tool: p.tool === 'claude-design' ? 'claude' : p.tool,
        })
        for (const c of p.changes) {
          say(`change.kind.${c.kind}`)
          say('owner', { owner: c.owner })
          say('change.after', { tool: p.tool })
        }
      }
    }
  })

  it('shows what adopting would change without changing anything', async () => {
    const before = await readFile(join(proposalsDir(), `${radius.id}.json`), 'utf8')
    const preview = await adoptPreview(project, radius.id)
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    expect(preview.files.map((f) => f.kind)).toEqual(expect.arrayContaining(['register', 'proposal']))
    expect(await readFile(join(proposalsDir(), `${radius.id}.json`), 'utf8')).toBe(before)
  })

  it('adopts a Figma change through Accord, records who decided, and can undo it', async () => {
    const result = await decideProposal(
      project,
      { id: radius.id, option: 'adopt', by: 'Jana', note: 'Karten wirken weicher' },
      new Date('2026-10-13T10:00:00Z'),
    )
    expect(result).toMatchObject({ ok: true, option: 'adopt', tokens: ['radius.md'] })
    let register = await loadRegister(join(dir, '.accord'))
    expect(register.tokens.get('radius.md')?.value).toEqual({ value: 0.75, unit: 'rem' })
    let view = (await loadInbox(project)).proposals.find((p) => p.id === radius.id)
    expect(view).toMatchObject({
      group: 'decided',
      decision: { option: 'adopt', by: 'Jana', note: 'Karten wirken weicher' },
    })

    // A second decision on the same proposal is refused by Accord.
    expect(await decideProposal(project, { id: radius.id, option: 'reject', by: 'Jana' })).toMatchObject({
      ok: false,
      code: 'already_resolved',
    })

    if (!result.ok) return
    expect(await undoDecision(project, result.undo)).toBe(true)
    register = await loadRegister(join(dir, '.accord'))
    expect(register.tokens.get('radius.md')?.value).toEqual({ value: 0.5, unit: 'rem' })
    view = (await loadInbox(project)).proposals.find((p) => p.id === radius.id)
    expect(view?.group).toBe('auto')
    expect(await undoDecision(project, result.undo)).toBe(false)
  })

  it('never adopts a deletion without an explicit confirmation', async () => {
    expect(await decideProposal(project, { id: deletion.id, option: 'adopt', by: 'Jana' })).toEqual({
      ok: false,
      code: 'needs_confirmation',
    })
    expect((await loadRegister(join(dir, '.accord'))).tokens.has('color.brand.700')).toBe(true)
    const result = await decideProposal(project, {
      id: deletion.id,
      option: 'adopt',
      by: 'Jana',
      confirmed: true,
    })
    expect(result).toMatchObject({ ok: true })
    expect((await loadRegister(join(dir, '.accord'))).tokens.has('color.brand.700')).toBe(false)
    if (result.ok) await undoDecision(project, result.undo)
    expect((await loadRegister(join(dir, '.accord'))).tokens.has('color.brand.700')).toBe(true)
  })

  it('adopts a handoff only with named colours from the handoff itself', async () => {
    const id = 'P-20261012-landing'
    expect(await decideProposal(project, { id, option: 'adopt', by: 'Jana' })).toMatchObject({
      ok: false,
      code: 'needs_names',
    })
    expect(
      await decideProposal(project, {
        id,
        option: 'adopt',
        by: 'Jana',
        names: [{ value: '#000001', token: 'color.sneaky' }],
      }),
    ).toMatchObject({ ok: false, code: 'invalid_input' })
    const adopted = await decideProposal(project, {
      id,
      option: 'adopt',
      by: 'Jana',
      names: [{ value: '#d81b60', token: 'color.accent' }],
    })
    expect(adopted).toMatchObject({ ok: true, tokens: ['color.accent'] })
    expect((await loadRegister(join(dir, '.accord'))).tokens.get('color.accent')?.type).toBe('color')
    if (adopted.ok) await undoDecision(project, adopted.undo)

    expect(await decideProposal(project, { id, option: 'reset', by: 'Jana' })).toMatchObject({
      ok: true,
      option: 'reset',
    })
    const view = (await loadInbox(project)).proposals.find((p) => p.id === id)
    expect(view).toMatchObject({ group: 'decided', decision: { option: 'reset', by: 'Jana' } })
    expect((await loadRegister(join(dir, '.accord'))).tokens.has('color.accent')).toBe(false)
  })

  it('refuses a decision without a name and an unknown proposal', async () => {
    expect(await decideProposal(project, { id: deletion.id, option: 'reject', by: '  ' })).toMatchObject({
      ok: false,
      code: 'invalid_input',
    })
    expect(await decideProposal(project, { id: 'P-unknown', option: 'reject', by: 'Jana' })).toMatchObject({
      ok: false,
      code: 'not_found',
    })
  })
})
