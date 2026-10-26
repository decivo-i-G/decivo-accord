import type { Register } from '@decivo/accord-core'
import type { HandoffProposal } from '../../src/claude-design.js'
import type { DriftReport } from '../../src/report.js'

/**
 * Fixed input for the accord.report/1 compatibility snapshot (`report-payload-v1.json`).
 * The snapshot was produced from this input by the report code before it was renamed; the new code must
 * produce the same JSON, byte for byte, so existing receivers keep working.
 */

export const SNAPSHOT_SOURCE = 'const secret = <div style={{ color: "#487a98" }} />'

export const snapshotMeta = {
  commit: 'e'.repeat(40),
  branch: 'feat/landing',
  defaultBranch: 'main',
  source: 'action' as const,
}

export const SNAPSHOT_VERSION = '9.9.9'

export function snapshotReport(): DriftReport {
  return {
    generatedAt: '2026-10-20T10:00:00.000Z',
    register: { tokens: 40, components: 6, decisions: 3, issues: [] },
    health: { score: 81.4, preliminary: true, parts: { tokenSync: 0.9, hardValues: 0.7 } },
    code: {
      tokensCovered: 30,
      tokensInSync: 27,
      drift: [
        {
          path: 'color.brand.700',
          kind: 'value',
          origin: 'design',
          owner: 'design',
          breaking: false,
          reason: 'value differs',
          register: '#3c6681',
          surface: '#3d6782',
        },
        {
          path: 'space.4',
          kind: 'removed',
          origin: 'code',
          owner: 'register',
          breaking: true,
          reason: 'missing in code',
        },
      ] as unknown as DriftReport['code']['drift'],
      missing: ['radius.lg', 'shadow.sm'],
      unreadable: [],
      unmapped: [{ name: '--secret', value: '#000', candidates: [] }],
      hardValues: [
        {
          file: 'src/app/page.tsx',
          line: 4,
          column: 7,
          raw: '#487a98',
          kind: 'color',
          context: SNAPSHOT_SOURCE,
          replacement: 'color.brand',
        },
        {
          file: 'src/app/card.tsx',
          line: 12,
          column: 2,
          raw: '13px',
          kind: 'dimension',
          context: SNAPSHOT_SOURCE,
          near: { path: 'space.3', distance: 1 },
        },
        {
          file: 'src/app/long.tsx',
          line: 1,
          column: 1,
          raw: `linear-gradient(${'#ffffff, '.repeat(10)}#000000)`,
          kind: 'color',
          context: SNAPSHOT_SOURCE,
        },
      ],
      hardValueSummary: { total: 3, exact: 1, near: 1, none: 1, files: 3 },
      inlineOnly: { total: 2, files: [{ file: 'emails/welcome.tsx', count: 2 }] },
      allowed: { total: 1, reasons: [{ reason: 'third-party widget', count: 1 }] },
      adoption: { tokenUses: 40, hardColours: 2, rate: 0.95 },
      tokenUsage: { 'color.brand.700': 12 },
      filesScanned: 9,
    },
  }
}

/** Just enough register for the proposal mapping: one colour token. */
export const snapshotRegister = {
  tokens: new Map([
    [
      'color.brand.700',
      {
        path: 'color.brand.700',
        type: 'color',
        value: { colorSpace: 'srgb', components: [0.235, 0.4, 0.506], hex: '#3C6681' },
      },
    ],
  ]),
} as unknown as Register

const violation = (over: Partial<HandoffProposal['violations'][number]> = {}) => ({
  decision: 'brand-colour',
  level: 'error',
  rule: 'Brand colour only from the register',
  why: 'Two nearly identical blues look like a mistake.',
  value: '#3D6782',
  nearest: 'color.brand.700',
  count: 3,
  ...over,
})

function handoff(over: Partial<HandoffProposal> = {}): HandoffProposal {
  return {
    id: 'P-20261020-landing',
    source: 'claude-design',
    bundle: { name: 'Landing', pages: ['Start'] },
    createdAt: '2026-10-20T08:00:00.000Z',
    route: 'owner',
    decider: 'design',
    colors: { inRegister: [], nearMisses: [], new: [] },
    violations: [violation()],
    ...over,
  }
}

export function snapshotProposals(): HandoffProposal[] {
  return [
    handoff({
      violations: [
        violation(),
        violation({ value: '#3d6782', count: 1 }),
        violation({ decision: 'no-pink', rule: 'No pink', why: 'Pink is not part of the brand.', value: '#ff00aa', nearest: undefined }),
        violation({ value: 'url(x)', nearest: undefined }),
      ],
    }),
    handoff({ id: 'P-20261020-auto', route: 'auto' }),
    handoff({
      id: 'P-20261020-pricing',
      bundle: { name: 'Pricing', pages: ['Pricing'] },
      decider: 'code',
      violations: [violation({ value: '#123456', nearest: undefined })],
    }),
  ]
}
