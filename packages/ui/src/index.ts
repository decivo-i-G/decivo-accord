import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where the bundled web app lives (built by `scripts/bundle.mjs`). */
export const APP_SERVER = fileURLToPath(new URL('../app/server.js', import.meta.url))

export const DEFAULT_PORT = 4317
const HOST = '127.0.0.1'

export interface UiProject {
  slug: string
  name: string
  root: string
  branch: string
}

export interface StartOptions {
  /** Repositories to show; default: the working directory. */
  roots?: string[] | undefined
  /** Port; default 4317, or the next free one. A port given here must be free. */
  port?: number | undefined
  /** Open the browser (default true). */
  open?: boolean | undefined
  /** How long to wait for the server, in ms (default 30 s). */
  timeout?: number | undefined
}

export interface RunningUi {
  url: string
  port: number
  projects: UiProject[]
  /** Resolves when the server process ends. */
  exited: Promise<number | null>
  stop(): void
}

const git = (cwd: string, args: string[]): string | undefined => {
  try {
    return (
      execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() ||
      undefined
    )
  } catch {
    return undefined
  }
}

/** URL part of a project: lowercase letters, digits and hyphens, unique among `taken`. */
export function slugOf(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  let slug = base
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`
  return slug
}

/** The projects for the given folders: each one's repository root (git), else the folder itself. */
export function projectsFor(roots: string[]): UiProject[] {
  const taken = new Set<string>()
  const seen = new Set<string>()
  const projects: UiProject[] = []
  for (const dir of roots.map((r) => resolve(r))) {
    if (!existsSync(dir)) throw new Error(`${dir} does not exist`)
    const root = git(dir, ['rev-parse', '--show-toplevel']) ?? dir
    if (seen.has(root)) continue
    seen.add(root)
    const name = basename(root)
    const slug = slugOf(name, taken)
    taken.add(slug)
    projects.push({ slug, name, root, branch: git(root, ['branch', '--show-current']) ?? 'main' })
  }
  return projects
}

const portFree = (port: number) =>
  new Promise<boolean>((done) => {
    const probe = createServer()
    probe.once('error', () => done(false))
    probe.listen(port, HOST, () => probe.close(() => done(true)))
  })

/** The given port (must be free), else the first free one from 4317 on. */
export async function choosePort(wanted?: number): Promise<number> {
  if (wanted !== undefined) {
    if (await portFree(wanted)) return wanted
    throw new Error(`port ${wanted} is in use`)
  }
  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + 50; port++) if (await portFree(port)) return port
  throw new Error(`no free port between ${DEFAULT_PORT} and ${DEFAULT_PORT + 49}`)
}

/**
 * The environment of the app process. Database and sign-in settings of the user's shell are dropped:
 * on the user's machine the app always runs in local mode.
 */
export function serverEnv(
  base: NodeJS.ProcessEnv,
  { port, token, projects }: { port: number; token: string; projects: UiProject[] },
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(base))
    if (!/^(DATABASE_URL|BETTER_AUTH_|GITHUB_CLIENT_|ACCORD_UI_|ACCORD_PROJECTS$|PORT$|HOSTNAME$)/.test(key))
      env[key] = value
  return {
    ...env,
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    PORT: String(port),
    HOSTNAME: HOST,
    ACCORD_PROJECTS: JSON.stringify(projects),
    ACCORD_UI_TOKEN: token,
    ACCORD_UI_HOSTS: `${HOST}:${port},localhost:${port}`,
  }
}

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['explorer.exe', [url]] // no shell: the token's characters need no quoting
        : ['xdg-open', [url]]
  const child = spawn(cmd, args as string[], { stdio: 'ignore', detached: true })
  child.on('error', () => {})
  child.unref()
}

async function waitUntilUp(port: number, child: ChildProcess, timeout: number, log: () => string) {
  const until = Date.now() + timeout
  let exited = false
  child.once('exit', () => {
    exited = true
  })
  while (Date.now() < until) {
    if (exited) throw new Error(`the app stopped while starting:\n${log()}`)
    // The guard answers 401 without the token: that already means the app is up.
    const status = await fetch(`http://${HOST}:${port}/`, { redirect: 'manual' }).then(
      (r) => r.status,
      () => 0,
    )
    if (status > 0) return
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`the app did not start within ${Math.round(timeout / 1000)} s:\n${log()}`)
}

/** Start the web app for the given repositories on 127.0.0.1 and return its address with the token. */
export async function startUi(options: StartOptions = {}): Promise<RunningUi> {
  if (!existsSync(APP_SERVER)) throw new Error(`the app bundle is missing (${APP_SERVER})`)
  const projects = projectsFor(options.roots?.length ? options.roots : [process.cwd()])
  const port = await choosePort(options.port)
  const token = randomBytes(32).toString('base64url')
  const child = spawn(process.execPath, [APP_SERVER], {
    env: serverEnv(process.env, { port, token, projects }),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const keep = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-4000)
  }
  child.stdout?.on('data', keep)
  child.stderr?.on('data', keep)
  const exited = new Promise<number | null>((done) => child.once('exit', (code) => done(code)))
  try {
    await waitUntilUp(port, child, options.timeout ?? 30_000, () => output.trim())
  } catch (error) {
    child.kill()
    throw error
  }
  const path = projects.length === 1 ? `/p/${projects[0]?.slug}` : '/'
  const url = `http://${HOST}:${port}${path}?t=${token}`
  if (options.open !== false) openBrowser(url)
  return { url, port, projects, exited, stop: () => void child.kill() }
}
