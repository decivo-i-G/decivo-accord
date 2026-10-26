import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { formatIssue, hasErrors, type Issue } from './issues.js'
import { buildRegister, type Register, type RegisterFile } from './register.js'

export const DEFAULT_REGISTER_DIR = '.accord'

/** Read every register file below `dir` (default `.accord`), skipping `generated/`. */
export async function readRegisterFiles(dir: string): Promise<RegisterFile[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  const files: RegisterFile[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const absolute = join(entry.parentPath, entry.name)
    const path = relative(dir, absolute).split(sep).join('/')
    if (path.startsWith('generated/')) continue
    files.push({ path, content: await readFile(absolute, 'utf8') })
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

export async function loadRegister(dir: string = DEFAULT_REGISTER_DIR): Promise<Register> {
  return buildRegister(await readRegisterFiles(dir))
}

/** The register has errors (unreadable JSON/YAML, invalid config or tokens); nothing may run on half of it. */
export class RegisterError extends Error {
  constructor(
    readonly dir: string,
    readonly issues: Issue[],
  ) {
    super(`register ${dir} has errors:\n${issues.map(formatIssue).join('\n')}`)
    this.name = 'RegisterError'
  }
}

/**
 * Read and build the register, refusing one with errors. A check that runs on a partly loaded register
 * would pass silently where it should fail, so every command except \`init\` loads through here.
 */
export async function readValidRegister(
  dir: string = DEFAULT_REGISTER_DIR,
): Promise<{ files: RegisterFile[]; register: Register }> {
  const files = await readRegisterFiles(dir)
  const register = buildRegister(files)
  if (hasErrors(register.issues))
    throw new RegisterError(
      dir,
      register.issues.filter((i) => i.severity === 'error'),
    )
  return { files, register }
}

export const loadValidRegister = async (dir: string = DEFAULT_REGISTER_DIR): Promise<Register> =>
  (await readValidRegister(dir)).register
