import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Write a generated file (CSS, DESIGN.md, AGENTS.md, a CLAUDE.md block) inside the project. A symlink there
 * is refused rather than followed: a cloned repository could otherwise point it at any file the user can write.
 */
export async function writeOutput(root: string, path: string, content: string): Promise<void> {
  const target = join(root, path)
  const existing = await lstat(target).catch(() => undefined)
  if (existing?.isSymbolicLink())
    throw new Error(`${path} is a symbolic link; Accord does not write through it.`)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content)
}
