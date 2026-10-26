import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { designLock, designReset, designStatus, ingestHandoff, saveProposal } from '../src/claude-design.js'
import { initCommand } from '../src/commands.js'
import { translator } from '../src/messages.js'

const fixture = fileURLToPath(new URL('./fixtures/shop', import.meta.url))
const D004 = `id: D-004
rule: Markenfarben nur aus der brand-Skala
why: Ein konsistentes Blau macht die Marke wiedererkennbar.
scope: [tokens.color.brand.**]
level: must
owner: design
checks:
  - type: deterministic
    rule: { kind: value_in_scale, scale: tokens.color.brand.** }
`

describe('Claude Design', () => {
  let dir: string
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'accord-claude-'))
    await cp(fixture, dir, { recursive: true })
    await initCommand(
      { root: dir, register: '.accord', force: false, dryRun: false },
      translator('de'),
      () => {},
    )
    await writeFile(join(dir, '.accord/decisions/D-004.yaml'), D004)
    const page = `<x-dc><div style="background:#4a7d9b;color:#16222b">Hero</div><a style="color:#3c6681">Mehr</a></x-dc>`
    await writeFile(
      join(dir, 'Landing-handoff.zip'),
      zipSync({
        'landing/README.md': strToU8('Read `landing/project/Landing.dc.html` in full.'),
        'landing/project/Landing.dc.html': strToU8(page),
      }),
    )
    git('init', '-q', '-b', 'main')
    // CI runners have no global git identity; the proposal commit needs one in this repo.
    git('config', 'user.email', 'test@accord.local')
    git('config', 'user.name', 'Accord Test')
    git('add', '.')
    git('commit', '-qm', 'init')
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('turns a handoff with an off-brand colour into a proposal for the design owner citing D-004', async () => {
    const proposal = await ingestHandoff({
      root: dir,
      registerDir: join(dir, '.accord'),
      bundle: join(dir, 'Landing-handoff.zip'),
      now: new Date('2026-10-12T10:00:00Z'),
    })
    expect(proposal).toMatchObject({ id: 'P-20261012-landing', route: 'owner', decider: 'design' })
    expect(proposal.bundle).toMatchObject({ name: 'Landing', primary: 'landing/project/Landing.dc.html' })
    expect(proposal.colors.nearMisses.map((c) => c.value)).toEqual(['#4a7d9b'])
    expect(proposal.violations).toContainEqual(
      expect.objectContaining({
        decision: 'D-004',
        value: '#4a7d9b',
        nearest: 'color.brand.$root',
        count: 1,
      }),
    )
  })

  it('commits the proposal on its own branch and leaves main untouched', async () => {
    const proposal = await ingestHandoff({
      root: dir,
      registerDir: join(dir, '.accord'),
      bundle: join(dir, 'Landing-handoff.zip'),
    })
    const saved = await saveProposal(proposal, { root: dir, registerDir: join(dir, '.accord'), branch: true })
    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe(saved.branch)
    expect(saved.branch).toMatch(/^accord\/handoff-p-\d{8}-landing$/)
    expect(git('log', '--oneline', 'main').split('\n')).toHaveLength(1)
    git('checkout', '-q', 'main')
  })

  it('resets a spacing edited in the design-system project and records the synced state', async () => {
    const mirror = join(dir, 'ds-mirror')
    await mkdir(mirror, { recursive: true })
    await writeFile(join(mirror, 'tokens.css'), ':root { --brand-blue: #487a98; --radius: 0.75rem; }\n')
    const registerDir = join(dir, '.accord')
    const before = await designStatus({ registerDir, mirror })
    expect(before.status.items).toMatchObject([{ origin: 'unknown', op: { path: 'tokens.radius.md' } }])
    const plan = await designReset({ registerDir, mirror })
    expect(plan.files[0]?.changes).toEqual([{ variable: '--radius', from: '0.75rem', to: '0.5rem' }])
    expect(await readFile(join(mirror, 'tokens.css'), 'utf8')).toContain('--radius: 0.5rem')
    expect(await designLock({ registerDir, mirror })).toBe(2)
    expect((await designStatus({ registerDir, mirror })).status.items).toEqual([])
  })
})
