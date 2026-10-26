import { formatIssue } from '@decivo/accord-core'
import { RegisterError } from '@decivo/accord-core/node'
import type { MessageKey, T } from './messages.js'

export const ISSUES_URL = 'https://github.com/decivo-i-G/decivo-accord/issues'

/** An error the user can fix; shown as a sentence, never as a stack trace. */
export class AccordError extends Error {
  constructor(
    readonly key: MessageKey,
    readonly params: Record<string, string | number> = {},
  ) {
    super(key)
    this.name = 'AccordError'
  }
}

interface NodeError extends Error {
  code?: string
  path?: string
}

/**
 * Turn any error into a message for the terminal. Known causes (missing register, missing file,
 * unreadable JSON) get a sentence with the next step; anything else is reported as unexpected,
 * with the stack only when ACCORD_DEBUG is set.
 */
export function explainError(error: unknown, t: T, context: { registerDir: string; debug: boolean }): string {
  const lines: string[] = []
  if (error instanceof AccordError) lines.push(t(error.key, error.params))
  else if (error instanceof RegisterError) {
    lines.push(t('error.invalidRegister', { dir: error.dir, count: error.issues.length }))
    for (const issue of error.issues) lines.push(`  ${formatIssue(issue)}`)
  } else {
    const e = error as NodeError
    const path = e?.path
    if (e?.code === 'ENOENT' && path && samePath(path, context.registerDir))
      lines.push(t('error.noRegister', { dir: context.registerDir }))
    else if (e?.code === 'ENOENT' && path) lines.push(t('error.notFound', { path }))
    else if ((e?.code === 'EACCES' || e?.code === 'EPERM') && path) lines.push(t('error.noAccess', { path }))
    else if (e?.code === 'ENOTDIR' && path) lines.push(t('error.notDir', { path }))
    else if (e instanceof SyntaxError) lines.push(t('error.parse', { message: e.message }))
    else lines.push(t('error.unexpected', { message: e?.message ?? String(error), url: ISSUES_URL }))
  }
  if (context.debug && error instanceof Error && error.stack) lines.push('', error.stack)
  return lines.join('\n')
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
const samePath = (a: string, b: string) => norm(a) === norm(b) || norm(a).endsWith(`/${norm(b)}`)
