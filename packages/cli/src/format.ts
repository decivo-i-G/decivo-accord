import { styleText } from 'node:util'
import { contextLabel, formatIssue } from '@decivo/accord-core'
import type { T } from './messages.js'
import type { DriftReport } from './report.js'

type Style = Parameters<typeof styleText>[0]
/** Colours only on a TTY and without NO_COLOR; styleText checks the stream itself. */
const paint = (style: Style, text: string) => styleText(style, text)

const heading = (text: string) => `\n${paint('bold', text)}`
const dim = (text: string) => paint('dim', text)

export interface FormatOptions {
  /** Maximum rows per list; the rest is summarised. */
  limit: number
}

function list<T>(
  items: readonly T[],
  limit: number,
  row: (item: T) => string,
  t: (k: 'diff.more', p: { count: number }) => string,
) {
  const lines = items.slice(0, limit).map(row)
  if (items.length > limit) lines.push(dim(`  ${t('diff.more', { count: items.length - limit })}`))
  return lines
}

export function formatDriftReport(
  report: DriftReport,
  t: T,
  { limit }: FormatOptions = { limit: 15 },
): string {
  const { code } = report
  const out: string[] = []
  out.push(paint('bold', t('diff.title')))
  out.push(
    `${t('diff.register')}: ${t('diff.registerSummary', {
      tokens: report.register.tokens,
      components: report.register.components,
      decisions: report.register.decisions,
    })}`,
  )
  out.push(
    `${t('diff.health')}: ${paint('bold', `${report.health.score}/100`)} ${dim(`(${t('diff.preliminary')})`)}`,
  )

  out.push(heading(t('diff.code')))
  out.push(
    `  ${t('diff.tokensInSync')}: ${code.tokensInSync} ${t('diff.of')} ${code.tokensCovered + code.unreadable.length}` +
      dim(
        ` · ${code.drift.length} ${t('diff.drifting')} · ${code.missing.length} ${t('diff.missing')} · ${code.unreadable.length} ${t('diff.unreadable')}`,
      ),
  )
  const s = code.hardValueSummary
  out.push(
    `  ${t('diff.adoption')}: ${Math.round(code.adoption.rate * 100)} %` +
      dim(
        ` · ${code.adoption.tokenUses} ${t('diff.tokenUses')} · ${code.adoption.hardColours} ${t('diff.hardColours')}`,
      ),
  )
  for (const m of code.modes ?? []) {
    if (m.selector && m.found)
      out.push(
        `  ${t('diff.modes', { context: m.context, selector: m.selector, how: t(`diff.modes.how.${m.how === 'configured' ? 'configured' : 'detected'}`) })}`,
      )
    else if (m.selector)
      out.push(`  ${t('diff.modes.notFound', { context: m.context, selector: m.selector })}`)
    else out.push(`  ${t('diff.modes.missing', { context: m.context })}`)
  }
  out.push(
    `  ${t('diff.hardValues')}: ${s.total}` +
      dim(
        ` · ${s.exact} ${t('diff.withToken')} · ${s.near} ${t('diff.nearMiss')} · ${s.none} ${t('diff.noToken')}`,
      ),
  )

  if (code.drift.length > 0) {
    out.push(heading(t('diff.driftHeading')))
    out.push(
      ...list(
        code.drift,
        limit,
        (d) => {
          const values =
            d.register !== undefined
              ? `  ${t('diff.registerValue')} ${d.register} · ${t('diff.surfaceValue')} ${d.surface}`
              : ''
          const flags = [t(`diff.origin.${d.origin}`), `${t('diff.owner')} ${t(`owner.${d.owner}`)}`]
          if (d.breaking) flags.push(paint('red', t('diff.breaking')))
          if (d.fallback === 'after')
            flags.push(t('diff.contextMissing', { context: contextLabel(d.context ?? {}) }))
          const where = d.context ? ` (${contextLabel(d.context)})` : ''
          return `  ${paint(d.breaking ? 'red' : 'yellow', '●')} ${d.path}${where}${values}  ${dim(`[${flags.join(', ')}]`)}`
        },
        t,
      ),
    )
  }

  if (code.missing.length > 0) {
    out.push(heading(`${t('diff.missingHeading')} (${code.missing.length})`))
    out.push(...list(code.missing, limit, (path) => `  ${path}`, t))
  }

  if (code.unmapped.length > 0) {
    out.push(heading(`${t('diff.unmappedHeading')} (${code.unmapped.length})`))
    out.push(
      ...list(
        code.unmapped,
        limit,
        (u) => {
          const hint = u.candidates[0] ? `→ ${u.candidates[0]}` : u.near ? `${t('diff.near')} ${u.near}` : ''
          return `  ${u.name} ${dim(u.value)} ${hint}`
        },
        t,
      ),
    )
  }

  if (code.hardValues.length > 0) {
    out.push(heading(`${t('diff.hardHeading')} (${s.files})`))
    const byFile = new Map<string, DriftReport['code']['hardValues']>()
    for (const h of code.hardValues) byFile.set(h.file, [...(byFile.get(h.file) ?? []), h])
    const files = [...byFile].sort((a, b) => b[1].length - a[1].length)
    out.push(
      ...list(
        files,
        limit,
        ([file, values]) => {
          const rows = values.slice(0, 3).map((h) => {
            const fix = h.replacement
              ? `${t('diff.replace')}: ${h.replacement}`
              : h.near
                ? `${t('diff.near')} ${h.near.path} (ΔE ${h.near.distance})`
                : ''
            return `      ${dim(`${h.line}:${h.column}`)} ${h.raw} ${fix ? dim(`→ ${fix}`) : ''}`
          })
          return [`  ${file} ${dim(`(${values.length})`)}`, ...rows].join('\n')
        },
        t,
      ),
    )
  }

  if (code.allowed.total > 0) {
    out.push(heading(`${t('diff.allowedHeading')} (${code.allowed.total})`))
    out.push(...list(code.allowed.reasons, limit, (r) => `  ${r.reason} ${dim(`(${r.count})`)}`, t))
  }

  if (code.inlineOnly.total > 0) {
    out.push(heading(`${t('diff.inlineHeading')} (${code.inlineOnly.total})`))
    out.push(dim(`  ${t('diff.inlineNote')}`))
    out.push(...list(code.inlineOnly.files, limit, (f) => `  ${f.file} ${dim(`(${f.count})`)}`, t))
  }

  const modes = report.modes
  if (modes && (modes.contrast.length > 0 || modes.fallbacks.some((f) => f.tokens.length > 0))) {
    out.push(heading(t('diff.modesHeading', { contexts: modes.contexts.join(', ') })))
    for (const c of modes.contrast)
      out.push(
        `  ${paint('red', '●')} ${t('diff.modes.contrast', {
          at: c.at,
          context: c.context ?? modes.default,
          ratio: c.ratio,
          against: c.against,
          required: c.required,
          decision: c.decision,
        })}`,
      )
    for (const f of modes.fallbacks.filter((f) => f.tokens.length > 0))
      out.push(
        `  ${t('diff.modes.fallbacks', {
          count: f.tokens.length,
          context: f.context,
          default: modes.default,
          names: f.tokens.slice(0, limit).join(', '),
        })}`,
      )
  }

  const issues = report.register.issues
  if (issues.length > 0) {
    out.push(heading(`${t('diff.issuesHeading')} (${issues.length})`))
    out.push(...list(issues, limit, (i) => `  ${formatIssue(i)}`, t))
  }

  if (code.drift.length === 0 && code.missing.length === 0 && code.hardValues.length === 0)
    out.push(`\n${t('diff.clean')}`)
  return out.join('\n')
}
