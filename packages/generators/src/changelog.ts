import { GENERATED_NOTICE } from './values.js'

/** What `accord apply` records on a decided proposal (see packages/cli/src/apply.ts). */
interface DecidedProposal {
  id: string
  source?: string
  bundle?: { name?: string }
  resolution: {
    option: 'adopt' | 'reset' | 'reject'
    items?: { token: string; value?: string; kind: 'change' | 'new' | 'remove'; context?: string }[]
    by: string
    at: string
    ref?: string
    note?: string
  }
}

/** Hex colours in one spelling; other values (font names) as decided. */
const hexLower = (value: string) => (value.startsWith('#') ? value.toLowerCase() : value)

const OPTION = { adopt: 'Adopted', reset: 'Reset to the register', reject: 'Rejected' } as const

function decided(files: readonly { path: string; content: string }[]): DecidedProposal[] {
  const out: DecidedProposal[] = []
  for (const file of files) {
    if (!/^proposals\/[^/]+\.json$/.test(file.path)) continue
    try {
      const p = JSON.parse(file.content) as Partial<DecidedProposal>
      const r = p.resolution
      if (
        typeof p.id === 'string' &&
        r &&
        r.option in OPTION &&
        typeof r.by === 'string' &&
        typeof r.at === 'string'
      )
        out.push(p as DecidedProposal)
    } catch {
      // Not a proposal; the changelog only lists what it can read.
    }
  }
  // Newest first; the id keeps the order stable for decisions made at the same moment.
  return out.sort((a, b) => b.resolution.at.localeCompare(a.resolution.at) || a.id.localeCompare(b.id))
}

/**
 * CHANGELOG.md of the design system, from the decided proposals in `.accord/proposals/`: what was
 * adopted, reset or rejected, by whom and where. Undefined while nothing has been decided.
 */
export function generateChangelog(files: readonly { path: string; content: string }[]): string | undefined {
  const entries = decided(files)
  if (entries.length === 0) return undefined
  const out = ['# Design system changelog', '', `> ${GENERATED_NOTICE}`, '']
  let day = ''
  for (const p of entries) {
    const r = p.resolution
    const date = r.at.slice(0, 10)
    if (date !== day) {
      if (day) out.push('')
      out.push(`## ${date}`, '')
      day = date
    }
    const name = p.bundle?.name ? ` "${p.bundle.name}"` : ''
    const source = p.source ? ` (${p.source})` : ''
    out.push(
      `- **${OPTION[r.option]}** \`${p.id}\`${name}${source}, decided by ${r.by}${r.ref ? ` (${r.ref})` : ''}`,
    )
    for (const item of r.items ?? []) {
      // A value in a context (dark) names it; removing it there leaves the token, which falls back to the default.
      const where = item.context ? ` (${item.context})` : ''
      out.push(
        item.kind === 'remove'
          ? `  - \`${item.token}\`${where}: ${item.context ? 'own value removed, the default value applies' : 'removed'}`
          : `  - \`${item.token}\`${where}: ${item.kind === 'new' ? 'new token ' : ''}${hexLower(item.value ?? '')}`,
      )
    }
    if (r.note) out.push(`  - ${r.note}`)
  }
  return `${out.join('\n')}\n`
}
