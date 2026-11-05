import { hasErrors } from '@decivo/accord-core'
import { loadRegisterOnce } from './page-meta'
import { hasRegister, type Project, registerDirOf } from './projects'

/**
 * Whether Accord can work with a project's register, the one answer every page gives:
 * - `none`: no register yet (`accord init`);
 * - `broken`: a register Accord cannot read (a broken config or token file; `accord diff` names it);
 * - `ok`.
 */
export type RegisterState = { state: 'none' } | { state: 'broken'; problems: string[] } | { state: 'ok' }

export async function registerState(project: Project): Promise<RegisterState> {
  if (!hasRegister(project)) return { state: 'none' }
  try {
    const register = await loadRegisterOnce(registerDirOf(project))
    if (!hasErrors(register.issues)) return { state: 'ok' }
    const problems = register.issues
      .filter((i) => i.severity === 'error')
      .map((i) => `${i.file ? `${i.file}: ` : ''}${i.message}`)
    return { state: 'broken', problems: problems.slice(0, 5) }
  } catch (error) {
    return { state: 'broken', problems: [error instanceof Error ? error.message : String(error)] }
  }
}
