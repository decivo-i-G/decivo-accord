import { timingSafeEqual } from 'node:crypto'

/**
 * Guard for `accord ui`: the app runs on the user's machine and writes into their repository, so a
 * page in the same browser must not be able to drive it.
 *
 * - **Host:** only the address `accord ui` opened (`127.0.0.1:<port>`, `localhost:<port>`). This stops
 *   DNS rebinding, where a foreign domain resolves to 127.0.0.1.
 * - **Token:** a random value per start. It arrives once in the opened address (`?t=…`), becomes an
 *   HttpOnly, SameSite=Strict cookie and leaves the address. Without it every request is refused.
 * - **Origin:** writing requests (server actions are POSTs) must come from the same address.
 *
 * Without ACCORD_UI_TOKEN (development, a hosted app) the guard does nothing.
 */

export const UI_COOKIE = 'accord_ui'

export interface GuardConfig {
  token: string
  /** Allowed `host:port` values. */
  hosts: string[]
}

export interface GuardRequest {
  method: string
  url: URL
  host: string | null
  origin: string | null
  cookie: string | undefined
}

export type GuardResult =
  | { kind: 'next' }
  | { kind: 'redirect'; location: string; cookie: string }
  | { kind: 'deny'; status: 401 | 403; reason: 'host' | 'origin' | 'token' }

export function guardConfig(env: Record<string, string | undefined> = process.env): GuardConfig | undefined {
  const token = env.ACCORD_UI_TOKEN
  if (!token) return undefined
  const hosts = (env.ACCORD_UI_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  return { token, hosts }
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function guard(req: GuardRequest, config: GuardConfig): GuardResult {
  const host = req.host?.toLowerCase() ?? ''
  if (!config.hosts.includes(host)) return { kind: 'deny', status: 403, reason: 'host' }

  const reading = req.method === 'GET' || req.method === 'HEAD'
  if (!reading && req.origin !== null && req.origin !== 'null') {
    let originHost: string
    try {
      originHost = new URL(req.origin).host.toLowerCase()
    } catch {
      return { kind: 'deny', status: 403, reason: 'origin' }
    }
    if (originHost !== host) return { kind: 'deny', status: 403, reason: 'origin' }
  } else if (!reading && req.origin === 'null') {
    return { kind: 'deny', status: 403, reason: 'origin' }
  }

  const offered = req.url.searchParams.get('t')
  if (offered !== null && reading) {
    if (!same(offered, config.token)) return { kind: 'deny', status: 401, reason: 'token' }
    const clean = new URL(req.url)
    clean.searchParams.delete('t')
    return { kind: 'redirect', location: `${clean.pathname}${clean.search}`, cookie: config.token }
  }

  if (req.cookie !== undefined && same(req.cookie, config.token)) return { kind: 'next' }
  return { kind: 'deny', status: 401, reason: 'token' }
}
