import { randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Guard for `accord ui`: the app runs on the user's machine and writes into their repository, so neither
 * a page in the same browser nor another local process may drive it.
 *
 * - **Host:** only the address `accord ui` opened (`127.0.0.1:<port>`, `localhost:<port>`). This stops
 *   DNS rebinding, where a foreign domain resolves to 127.0.0.1.
 * - **One-time code:** the opened address carries `?t=<code>`. The code works once: it is exchanged for a
 *   random session value in an HttpOnly, SameSite=Strict cookie and leaves the address. A copied address,
 *   the browser history or a process list is worth nothing afterwards. `accord ui` hands out a new code
 *   when you press Enter in its terminal.
 * - **Cookie per instance:** browsers do not separate cookies by port, so every instance has its own
 *   cookie name. Two `accord ui` side by side do not log each other out.
 * - **Origin:** writing requests (server actions are POSTs) must come from the same address.
 * - **No framing:** another local page must not embed the app and click "adopt" through it.
 *
 * Codes and sessions live in the server process (`globalThis`), where `@decivo/accord-ui` also delivers
 * new codes over its IPC channel. Without ACCORD_UI_INSTANCE (development, a hosted app) the guard is off.
 */

export interface GuardConfig {
  /** Random per start; the guard sends it back so `accord ui` knows it reached its own server. */
  instance: string
  /** Allowed `host:port` values. */
  hosts: string[]
  cookie: string
}

export interface GuardState {
  codes: Set<string>
  sessions: Set<string>
}

export interface GuardRequest {
  method: string
  url: URL
  host: string | null
  origin: string | null
  /** Value of the instance's cookie, if sent. */
  cookie: string | undefined
}

export type GuardResult =
  | { kind: 'next' }
  | { kind: 'redirect'; location: string; session: string }
  | { kind: 'deny'; status: 401 | 403; reason: 'host' | 'origin' | 'token' | 'used' }

const STATE_KEY = Symbol.for('decivo.accord.ui.guard')

/** The process-wide state; `@decivo/accord-ui`'s preload creates it and adds codes to it. */
export function guardState(): GuardState {
  const g = globalThis as { [STATE_KEY]?: GuardState }
  g[STATE_KEY] ??= { codes: new Set(), sessions: new Set() }
  return g[STATE_KEY]
}

export function guardConfig(env: Record<string, string | undefined> = process.env): GuardConfig | undefined {
  const instance = env.ACCORD_UI_INSTANCE
  if (!instance) return undefined
  const hosts = (env.ACCORD_UI_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  const port = hosts[0]?.split(':').pop() ?? '0'
  return { instance, hosts, cookie: `accord_ui_${port}` }
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
const has = (set: Set<string>, value: string) => {
  let found = false
  for (const v of set) if (same(v, value)) found = true
  return found
}

export function guard(
  req: GuardRequest,
  config: GuardConfig,
  state: GuardState,
  newSession: () => string = () => randomBytes(32).toString('base64url'),
): GuardResult {
  const host = req.host?.toLowerCase() ?? ''
  if (!config.hosts.includes(host)) return { kind: 'deny', status: 403, reason: 'host' }

  const reading = req.method === 'GET' || req.method === 'HEAD'
  if (!reading && req.origin !== null) {
    let originHost: string | undefined
    try {
      originHost = req.origin === 'null' ? undefined : new URL(req.origin).host.toLowerCase()
    } catch {
      originHost = undefined
    }
    if (originHost !== host) return { kind: 'deny', status: 403, reason: 'origin' }
  }

  const code = req.url.searchParams.get('t')
  if (code !== null && reading) {
    if (!has(state.codes, code)) return { kind: 'deny', status: 401, reason: 'used' }
    for (const c of state.codes) if (same(c, code)) state.codes.delete(c)
    const session = newSession()
    state.sessions.add(session)
    const clean = new URL(req.url)
    clean.searchParams.delete('t')
    return { kind: 'redirect', location: `${clean.pathname}${clean.search}`, session }
  }

  if (req.cookie !== undefined && has(state.sessions, req.cookie)) return { kind: 'next' }
  return { kind: 'deny', status: 401, reason: 'token' }
}
