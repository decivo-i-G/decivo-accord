import { describe, expect, it } from 'vitest'
import { type GuardRequest, type GuardState, guard, guardConfig } from './ui-guard'

const config = { instance: 'inst', hosts: ['127.0.0.1:4317', 'localhost:4317'], cookie: 'accord_ui_4317' }
const fresh = (): GuardState => ({ codes: new Set(['code-1']), sessions: new Set(['session-1']) })
const req = (over: Partial<GuardRequest> & { path?: string } = {}): GuardRequest => ({
  method: 'GET',
  url: new URL(`http://127.0.0.1:4317${over.path ?? '/'}`),
  host: '127.0.0.1:4317',
  origin: null,
  cookie: 'session-1',
  ...over,
})

describe('ui guard', () => {
  it('is off without an instance; the cookie name carries the port', () => {
    expect(guardConfig({})).toBeUndefined()
    expect(
      guardConfig({ ACCORD_UI_INSTANCE: 'x', ACCORD_UI_HOSTS: '127.0.0.1:4400, Localhost:4400' }),
    ).toEqual({
      instance: 'x',
      hosts: ['127.0.0.1:4400', 'localhost:4400'],
      cookie: 'accord_ui_4400',
    })
  })

  it('lets the page through with a session', () => {
    expect(guard(req(), config, fresh())).toEqual({ kind: 'next' })
    expect(guard(req({ host: 'LOCALHOST:4317' }), config, fresh())).toEqual({ kind: 'next' })
  })

  it('refuses a foreign host (DNS rebinding) even with a session', () => {
    for (const host of ['evil.example:4317', '127.0.0.1:9999', '127.0.0.1.:4317', null])
      expect(guard(req({ host }), config, fresh())).toMatchObject({
        kind: 'deny',
        status: 403,
        reason: 'host',
      })
  })

  it('refuses requests without a session or with an unknown one', () => {
    expect(guard(req({ cookie: undefined }), config, fresh())).toMatchObject({ kind: 'deny', status: 401 })
    expect(guard(req({ cookie: 'code-1' }), config, fresh())).toMatchObject({ kind: 'deny', reason: 'token' })
    expect(guard(req({ cookie: 'x' }), config, fresh())).toMatchObject({ kind: 'deny', reason: 'token' })
  })

  it('exchanges the code once for a new session and removes it from the address', () => {
    const state = fresh()
    const first = guard(
      req({ cookie: undefined, path: '/p/shop?x=1&t=code-1' }),
      config,
      state,
      () => 'session-2',
    )
    expect(first).toEqual({ kind: 'redirect', location: '/p/shop?x=1', session: 'session-2' })
    expect(state.sessions.has('session-2')).toBe(true)
    expect(state.codes.size).toBe(0)
    const again = guard(req({ cookie: undefined, path: '/?t=code-1' }), config, state)
    expect(again).toMatchObject({ kind: 'deny', status: 401, reason: 'used' })
    expect(guard(req({ cookie: undefined, path: '/?t=wrong' }), config, fresh())).toMatchObject({
      reason: 'used',
    })
  })

  it('refuses writes from another origin, also with a valid session', () => {
    const post = (origin: string | null) => guard(req({ method: 'POST', origin }), config, fresh())
    expect(post('http://127.0.0.1:4317')).toEqual({ kind: 'next' })
    expect(post(null)).toEqual({ kind: 'next' })
    for (const origin of [
      'https://evil.example',
      'http://localhost:4317',
      'http://127.0.0.1:4318',
      'null',
      'x',
    ])
      expect(post(origin)).toMatchObject({ kind: 'deny', reason: 'origin' })
  })

  it('does not take a code from the address on a write', () => {
    const state = fresh()
    const r = req({ method: 'POST', origin: 'http://127.0.0.1:4317', cookie: undefined, path: '/?t=code-1' })
    expect(guard(r, config, state)).toMatchObject({ kind: 'deny', reason: 'token' })
    expect(state.codes.has('code-1')).toBe(true)
  })
})
