import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadRegister } from '@decivo/accord-core/node'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HandoffProposal } from '../src/claude-design.js'
import { initCommand, reportCommand } from '../src/commands.js'
import { translator } from '../src/messages.js'
import type { DriftReport } from '../src/report.js'
import {
  checkReportUrl,
  loadProposals,
  MAX_HARD_VALUES,
  MAX_PROPOSALS,
  ReportError,
  sendReport,
  toReportPayload,
  toReportProposals,
} from '../src/report-payload.js'
import {
  SNAPSHOT_VERSION,
  snapshotMeta,
  snapshotProposals,
  snapshotRegister,
  snapshotReport,
} from './fixtures/report-payload-input.js'

const SOURCE = 'const secret = <div style={{ color: "#487a98" }} />'
const TOKEN = 'rcv_secret_token'

function report(hardValues = 2): DriftReport {
  return {
    generatedAt: '2026-10-12T16:29:47.094Z',
    register: { tokens: 96, components: 13, decisions: 2, issues: [] },
    health: {
      score: 74.6,
      preliminary: true,
      parts: { tokenSync: 1, hardValues: 0.5 },
    },
    code: {
      tokensCovered: 89,
      tokensInSync: 89,
      drift: [],
      missing: [],
      unreadable: [],
      unmapped: [{ name: '--secret', value: '#000', candidates: [] }],
      hardValues: Array.from({ length: hardValues }, (_, i) => ({
        file: 'src/app/page.tsx',
        line: i + 1,
        column: 3,
        raw: '#487a98',
        kind: 'color' as const,
        context: SOURCE,
        replacement: 'color.brand',
      })),
      hardValueSummary: {
        total: hardValues,
        exact: hardValues,
        near: 0,
        none: 0,
        files: 1,
      },
      inlineOnly: { total: 0, files: [] },
      allowed: { total: 0, reasons: [] },
      adoption: { tokenUses: 10, hardColours: hardValues, rate: 0.8 },
      filesScanned: 4,
    },
  }
}

const meta = {
  commit: 'a'.repeat(40),
  branch: 'main',
  defaultBranch: 'main',
  source: 'action' as const,
}

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>

const ok = (body: unknown = { created: true }, status = 201): FetchMock =>
  vi.fn<typeof fetch>(async () => Response.json(body, { status }))

const headersOf = (fetch: FetchMock) => (fetch.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>
const bodyOf = (fetch: FetchMock) =>
  JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as Record<string, unknown>

describe('report payload (accord.report/1)', () => {
  it('contains no source lines and no unmapped variables', () => {
    const payload = toReportPayload(report(), meta, '1.2.3')
    const text = JSON.stringify(payload)
    expect(text).not.toContain(SOURCE)
    expect(text).not.toContain('--secret')
    expect(payload).toMatchObject({
      schema: 'accord.report/1',
      accord_version: '1.2.3',
      commit: 'a'.repeat(40),
      default_branch: 'main',
      report: { health: { score: 75 } },
    })
    expect(payload.report.code.hardValues[0]).toEqual({
      file: 'src/app/page.tsx',
      line: 1,
      column: 3,
      raw: '#487a98',
      kind: 'color',
      replacement: 'color.brand',
    })
  })

  it('caps lists and keeps the summary', () => {
    const payload = toReportPayload(report(MAX_HARD_VALUES + 5), meta)
    expect(payload.report.code.hardValues).toHaveLength(MAX_HARD_VALUES)
    expect(payload.report.code.hardValueSummary.total).toBe(MAX_HARD_VALUES + 5)
  })

  it('is byte for byte the payload existing receivers get today (snapshot from before the rename)', async () => {
    const expected = await readFile(new URL('./fixtures/report-payload-v1.json', import.meta.url), 'utf8')
    const payload = toReportPayload(
      snapshotReport(),
      snapshotMeta,
      SNAPSHOT_VERSION,
      toReportProposals(snapshotProposals(), snapshotRegister),
    )
    expect(`${JSON.stringify(payload, null, 2)}\n`).toBe(expected)
    // What goes over the wire is the compact form of the same object.
    expect(JSON.stringify(payload)).toBe(JSON.stringify(JSON.parse(expected)))
  })
})

describe('sendReport', () => {
  it('posts to exactly the given URL, without changing the path', async () => {
    for (const url of [
      'https://receiver.test/',
      'https://receiver.test/api/projects/DECI/ingest/accord',
      'https://receiver.test/hooks/accord/?project=DECI',
    ]) {
      const fetch = ok()
      await sendReport({ url, token: TOKEN, payload: toReportPayload(report(), meta), fetch })
      expect(fetch.mock.calls[0]?.[0]).toBe(url)
    }
  })

  it('sends the token as Bearer and the payload as JSON', async () => {
    const fetch = ok()
    const payload = toReportPayload(report(), meta)
    const result = await sendReport({ url: 'https://receiver.test/hook', token: TOKEN, payload, fetch })
    expect(result).toEqual({ status: 201, created: true })
    const init = fetch.mock.calls[0]?.[1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' })
    expect(init.body).toBe(JSON.stringify(payload))
  })

  it('sends no auth header without a token', async () => {
    const fetch = ok({}, 202)
    const result = await sendReport({
      url: 'https://receiver.test/hook',
      payload: toReportPayload(report(), meta),
      fetch,
    })
    expect(result).toEqual({ status: 202 })
    expect(headersOf(fetch)).toEqual({ 'content-type': 'application/json' })
  })

  it("fails with the receiver's message when rejected, without showing the token", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ message: `Token invalid or revoked: ${TOKEN}` }, { status: 401 }),
    )
    const error = await sendReport({
      url: `https://receiver.test/hook?key=${TOKEN}`,
      token: TOKEN,
      payload: toReportPayload(report(), meta),
      fetch,
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ReportError)
    expect((error as ReportError).failure).toEqual({
      kind: 'rejected',
      endpoint: 'https://receiver.test/hook',
      status: 401,
      detail: 'Token invalid or revoked: [redacted]',
    })
    expect(JSON.stringify((error as ReportError).failure)).not.toContain(TOKEN)
  })

  it('fails clearly when the receiver is unreachable, without showing the token', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new TypeError(`connect ECONNREFUSED (${TOKEN})`)
    })
    const error = await sendReport({
      url: 'https://receiver.test/hook',
      token: TOKEN,
      payload: toReportPayload(report(), meta),
      fetch,
    }).catch((e: unknown) => e)
    expect((error as ReportError).failure).toEqual({
      kind: 'unreachable',
      endpoint: 'https://receiver.test/hook',
      detail: 'connect ECONNREFUSED ([redacted])',
    })
  })

  it('allows https everywhere and plain http only to this machine', () => {
    expect(checkReportUrl('https://receiver.test/hook').host).toBe('receiver.test')
    expect(checkReportUrl('http://localhost:3000/hook').hostname).toBe('localhost')
    expect(checkReportUrl('http://127.0.0.1:8080/hook').hostname).toBe('127.0.0.1')
    const kind = (url: string) => {
      try {
        checkReportUrl(url)
        return 'ok'
      } catch (error) {
        return (error as ReportError).failure.kind
      }
    }
    expect(kind('http://receiver.test/hook')).toBe('insecure-url')
    expect(kind('http://localhost.receiver.test/hook')).toBe('insecure-url')
    expect(kind('ftp://receiver.test/hook')).toBe('invalid-url')
    expect(kind('receiver.test/hook')).toBe('invalid-url')
  })

  it('never calls fetch for an http address outside this machine', async () => {
    const fetch = ok()
    await expect(
      sendReport({ url: 'http://receiver.test/hook', payload: toReportPayload(report(), meta), fetch }),
    ).rejects.toThrow(ReportError)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('accord report', () => {
  const t = translator('de')
  let root = ''
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'accord-report-'))
    await cp(fileURLToPath(new URL('./fixtures/shop', import.meta.url)), root, {
      recursive: true,
    })
    expect(await initCommand({ root, register: '.accord', force: false, dryRun: false }, t, () => {})).toBe(0)
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const base = {
    register: '.accord',
    commit: 'b'.repeat(40),
    branch: 'feat/x',
    defaultBranch: 'main',
    source: 'action' as const,
    json: false,
  }
  const run = async (
    opts: Partial<Parameters<typeof reportCommand>[0]>,
    env: NodeJS.ProcessEnv,
    fetch: FetchMock = ok({ created: false }, 200),
  ) => {
    const out: string[] = []
    const code = await reportCommand({ root, ...base, ...opts }, t, (s) => out.push(s), env, fetch)
    return { code, out: out.join('\n'), fetch }
  }

  it('without a URL, prints the report and sends nothing, even with a token', async () => {
    const { code, out, fetch } = await run({}, { ACCORD_REPORT_TOKEN: TOKEN })
    expect(code).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
    expect(JSON.parse(out)).toMatchObject({ schema: 'accord.report/1', branch: 'feat/x' })
    expect(out).not.toContain(TOKEN)
  })

  it('with --json, prints the report and sends nothing, even with a URL', async () => {
    const { code, out, fetch } = await run(
      { json: true, url: 'https://receiver.test/hook' },
      { ACCORD_REPORT_URL: 'https://receiver.test/hook', ACCORD_REPORT_TOKEN: TOKEN },
    )
    expect(code).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
    expect(JSON.parse(out)).toMatchObject({ schema: 'accord.report/1' })
  })

  it('sends to ACCORD_REPORT_URL with branch and default branch, without source lines', async () => {
    const url = 'https://receiver.test/api/projects/DECI/ingest/accord'
    const { code, out, fetch } = await run({}, { ACCORD_REPORT_URL: url, ACCORD_REPORT_TOKEN: TOKEN })
    expect(code).toBe(0)
    expect(out).toContain('ersetzt')
    expect(fetch.mock.calls[0]?.[0]).toBe(url)
    expect(headersOf(fetch).authorization).toBe(`Bearer ${TOKEN}`)
    const body = bodyOf(fetch)
    expect(body).toMatchObject({
      commit: 'b'.repeat(40),
      branch: 'feat/x',
      default_branch: 'main',
      source: 'action',
    })
    expect(JSON.stringify(body)).not.toContain('"context"')
  })

  it('--url wins over ACCORD_REPORT_URL and is used as given', async () => {
    const { fetch } = await run(
      { url: 'https://other.test/hook/' },
      { ACCORD_REPORT_URL: 'https://receiver.test/hook' },
    )
    expect(fetch.mock.calls[0]?.[0]).toBe('https://other.test/hook/')
  })

  it('takes the token only from the environment; --token-env names the variable', async () => {
    const plain = await run({ url: 'https://receiver.test/hook' }, {})
    expect(headersOf(plain.fetch).authorization).toBeUndefined()
    const named = await run(
      { url: 'https://receiver.test/hook', tokenEnv: 'MY_RECEIVER_TOKEN' },
      { MY_RECEIVER_TOKEN: 'named_token', ACCORD_REPORT_TOKEN: TOKEN },
    )
    expect(headersOf(named.fetch).authorization).toBe('Bearer named_token')
  })

  it('refuses plain http outside this machine and says why (exit 2, nothing sent)', async () => {
    const { code, out, fetch } = await run(
      { url: 'http://receiver.test/hook' },
      { ACCORD_REPORT_TOKEN: TOKEN },
    )
    expect(code).toBe(2)
    expect(fetch).not.toHaveBeenCalled()
    expect(out).toContain('unverschlüsselt')
    expect(out).toContain('localhost')
  })

  it('allows plain http to localhost', async () => {
    const { code, fetch } = await run({ url: 'http://localhost:4000/hook' }, {})
    expect(code).toBe(0)
    expect(fetch.mock.calls[0]?.[0]).toBe('http://localhost:4000/hook')
  })

  it('a rejected report fails with exit 2 and never shows the token', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ message: `bad token ${TOKEN}` }, { status: 403 }),
    )
    const { code, out } = await run(
      { url: 'https://receiver.test/hook' },
      { ACCORD_REPORT_TOKEN: TOKEN },
      fetch,
    )
    expect(code).toBe(2)
    expect(out).toContain('abgelehnt (403)')
    expect(out).not.toContain(TOKEN)
  })

  it('an unreachable receiver fails with exit 2', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new TypeError('fetch failed')
    })
    const { code, out } = await run({ url: 'https://receiver.test/hook' }, {}, fetch)
    expect(code).toBe(2)
    expect(out).toContain('nicht erreichbar')
  })
})

// Proposals that need a person travel with the report, so a receiver can show them as open decisions.
const VIOLATION: HandoffProposal['violations'][number] = {
  decision: 'brand-colour',
  level: 'error',
  rule: 'Markenfarbe nur aus dem Register',
  why: 'Zwei fast gleiche Blautöne wirken wie ein Fehler.',
  value: '#4a7b9a',
  nearest: 'color.brand-blue',
  count: 3,
}

function handoff(over: Partial<HandoffProposal> = {}): HandoffProposal {
  return {
    id: 'P-20261018-landingpage',
    source: 'claude-design',
    bundle: { name: 'Landingpage', pages: ['Start'] },
    createdAt: '2026-10-18T08:00:00.000Z',
    route: 'owner',
    decider: 'design',
    colors: { inRegister: [], nearMisses: [], new: [] },
    violations: [VIOLATION],
    ...over,
  }
}

describe('proposals in the report', () => {
  const t = translator('de')
  let root = ''
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'accord-proposals-'))
    await cp(fileURLToPath(new URL('./fixtures/shop', import.meta.url)), root, {
      recursive: true,
    })
    expect(await initCommand({ root, register: '.accord', force: false, dryRun: false }, t, () => {})).toBe(0)
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('sends only proposals that need a person (route owner), capped at 50 (x1)', async () => {
    const register = await loadRegister(join(root, '.accord'))
    // The brand colour itself (#487a98); color.brand.700 is a different shade.
    const brand = 'color.brand.$root'
    expect(register.tokens.has(brand)).toBe(true)
    const nearest = { nearest: brand }
    const proposals = [
      handoff({
        id: 'P-owner',
        violations: [{ ...VIOLATION, ...nearest }],
      }),
      handoff({ id: 'P-auto', route: 'auto' }),
      handoff({ id: 'P-explain', route: 'explain' }),
      ...Array.from({ length: 60 }, (_, i) => handoff({ id: `P-${i}` })),
    ]
    const out = toReportProposals(proposals, register)
    expect(out.map((p) => p.id)).not.toContain('P-auto')
    expect(out.map((p) => p.id)).not.toContain('P-explain')
    expect(out).toHaveLength(MAX_PROPOSALS)
    const [first] = out
    expect(first).toMatchObject({
      id: 'P-owner',
      source: 'claude-design',
      route: 'owner',
      decider: 'design',
      breaking: false,
      rules: [
        {
          id: 'brand-colour',
          rule: 'Markenfarbe nur aus dem Register',
          why: 'Zwei fast gleiche Blautöne wirken wie ein Fehler.',
        },
      ],
    })
    expect(first?.title).toContain('Landingpage')
    // before = the token's value in the register, after = the colour in the draft
    expect(first?.colors).toEqual([{ token: brand, before: '#487a98', after: '#4a7b9a', count: 3 }])
    expect(first?.recommendation.option).toBe('reset')
    expect(first?.recommendation.reason).toContain('Zwei fast gleiche Blautöne')
  })

  it('a colour without a close token: no "before", Accord recommends asking the owner', async () => {
    const register = await loadRegister(join(root, '.accord'))
    const [p] = toReportProposals(
      [
        handoff({
          violations: [
            {
              ...VIOLATION,
              value: '#ff00aa',
              nearest: undefined,
            },
          ],
        }),
      ],
      register,
    )
    expect(p?.colors).toEqual([{ after: '#ff00aa', count: 3 }])
    expect(p?.recommendation.option).toBe('ask')
  })

  it('only hex colours leave Accord, at most 20 per proposal', async () => {
    const register = await loadRegister(join(root, '.accord'))
    const violations = [
      { ...VIOLATION, value: 'url(x)', nearest: undefined },
      ...Array.from({ length: 25 }, (_, i) => ({
        ...VIOLATION,
        value: `#0000${(i + 16).toString(16)}`,
        nearest: undefined,
      })),
    ]
    const [p] = toReportProposals([handoff({ violations })], register)
    expect(p?.colors.every((c) => /^#[0-9a-f]{6}$/.test(c.after))).toBe(true)
    expect(p?.colors).toHaveLength(20)
  })

  it('a decided proposal (with resolution) is not sent again', async () => {
    const register = await loadRegister(join(root, '.accord'))
    const decided = { ...handoff({ id: 'P-decided' }), resolution: { option: 'reset', by: 'Janni' } }
    const out = toReportProposals([decided, handoff({ id: 'P-open' })], register)
    expect(out.map((p) => p.id)).toEqual(['P-open'])
  })

  it('reads proposals from .accord/proposals and skips unreadable files', async () => {
    const dir = join(root, '.accord', 'proposals')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'P-owner.json'), JSON.stringify(handoff({ id: 'P-owner' })))
    await writeFile(join(dir, 'kaputt.json'), '{ nicht json')
    await writeFile(join(dir, 'notiz.md'), '# keine Vorschlagsdatei')
    const loaded = await loadProposals(join(root, '.accord'))
    expect(loaded.map((p) => p.id)).toEqual(['P-owner'])
  })

  it('the sent report carries the proposals', async () => {
    const fetch = ok()
    const code = await reportCommand(
      {
        root,
        register: '.accord',
        url: 'https://receiver.test/hook',
        commit: 'd'.repeat(40),
        branch: 'accord/handoff-p-owner',
        defaultBranch: 'main',
        source: 'action',
        json: false,
      },
      t,
      () => {},
      { ACCORD_REPORT_TOKEN: TOKEN },
      fetch,
    )
    expect(code).toBe(0)
    const body = bodyOf(fetch) as { proposals?: { id: string }[] }
    expect(body.proposals?.map((p) => p.id)).toEqual(['P-owner'])
  })
})
