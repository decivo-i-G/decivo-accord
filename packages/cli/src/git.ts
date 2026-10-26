import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AccordError } from './errors.js'

const exec = promisify(execFile)

/** Run git for a step that must succeed; a failure becomes a sentence with git's own reason. */
export async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec('git', args, { cwd })
    return stdout
  } catch (error) {
    const e = error as { code?: string | number; stderr?: string; message?: string }
    if (e.code === 'ENOENT') throw new AccordError('error.gitMissing')
    const reason = (e.stderr || e.message || '').trim().split('\n').find(Boolean) ?? ''
    throw new AccordError('error.git', {
      command: `git ${args[0]}`,
      message: reason.replace(/^fatal:\s*/, ''),
    })
  }
}
