import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import type { T } from './messages.js'

/**
 * `accord ui` starts the web app from `@decivo/accord-ui`. That package carries a whole web server
 * (~25 MB), so the CLI does not depend on it: agents and CI running `npx @decivo/accord-cli check` would
 * load it for nothing. An installed copy is used; otherwise npx fetches the same version once.
 */
export const UI_PACKAGE = '@decivo/accord-ui'

/** `dist/bin.js` of an installed `@decivo/accord-ui`, looked up from each base (a file path or URL). */
export function findUiBin(bases: string[]): string | undefined {
  for (const base of bases) {
    try {
      const manifest = createRequire(base).resolve(`${UI_PACKAGE}/package.json`)
      const bin = join(dirname(manifest), 'dist', 'bin.js')
      if (existsSync(bin)) return bin
    } catch {
      // not installed there
    }
  }
  return undefined
}

export interface UiOptions {
  root: string
  folders: string[]
  port?: number | undefined
  open: boolean
}

export function uiArgs({ root, folders, port, open }: UiOptions): string[] {
  return [
    ...(folders.length > 0 ? folders : [root]).map((f) => resolve(f)),
    ...(port !== undefined ? ['--port', String(port)] : []),
    ...(open ? [] : ['--no-open']),
  ]
}

const quote = (arg: string) => (/[\s"&|<>^]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg)

export async function uiCommand(
  o: UiOptions,
  version: string,
  t: T,
  print: (text: string) => void,
): Promise<number> {
  const args = uiArgs(o)
  const installed = findUiBin([import.meta.url, join(resolve(o.root), 'package.json')])
  const pkg = `${UI_PACKAGE}@${version}`
  const windows = process.platform === 'win32'
  if (!installed) print(t('ui.download', { pkg }))
  const child = installed
    ? spawn(process.execPath, [installed, ...args], { stdio: 'inherit' })
    : // npx is a .cmd file on Windows, which only runs through the shell; the arguments are quoted for it.
      spawn(windows ? 'npx.cmd' : 'npx', ['--yes', pkg, ...args].map(windows ? quote : (a) => a), {
        stdio: 'inherit',
        shell: windows,
      })
  // Ctrl+C in a terminal reaches both processes; a signal sent to this process alone (kill, a closed
  // terminal, a process manager) is passed on, so the app never outlives the command.
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
  const forward = (signal: NodeJS.Signals) => {
    if (child.exitCode === null) child.kill(signal)
  }
  for (const s of signals) process.on(s, forward)
  try {
    return await new Promise<number>((done) => {
      child.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') print(t('ui.noNpx', { pkg: UI_PACKAGE }))
        else print(error.message)
        done(1)
      })
      child.once('exit', (code, signal) => done(code ?? (signal ? 0 : 1)))
    })
  } finally {
    for (const s of signals) process.off(s, forward)
  }
}
