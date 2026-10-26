export type IssueSeverity = 'error' | 'warning'

export interface Issue {
  severity: IssueSeverity
  code: string
  message: string
  /** File the issue was found in, relative to the register root. */
  file?: string | undefined
  /** Dot path inside the file (token path, contract field, decision id). */
  path?: string | undefined
}

export const hasErrors = (issues: readonly Issue[]): boolean => issues.some((i) => i.severity === 'error')

export function formatIssue(issue: Issue): string {
  const where = [issue.file, issue.path].filter(Boolean).join(' › ')
  return `${issue.severity === 'error' ? '✗' : '!'} ${where ? `${where}: ` : ''}${issue.message} [${issue.code}]`
}
