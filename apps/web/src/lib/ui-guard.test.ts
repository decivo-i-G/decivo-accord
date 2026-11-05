import { describe, expect, it } from 'vitest'
import { type GuardRequest, guard, guardConfig } from './ui-guard'

const config = { token: 'a'.repeat(43), hosts: ['127.0.0.1:4317', 'localhost:4317'] }
const req = (over: Partial<GuardRequest> & { path?: string } = {}): GuardRequest => ({
  method: 'GET',
  url: new URL(`http://127.0.0.1:4317${over.path ?? '/'}`),
  host: '127.0.0.1:4317',
  origin: null,
  cookie: config.token,
  ...over,
})

describe('ui guard', () => {
  it('is off without a token and reads the allowed hosts', () => {
    expect(guardConfig({})).toBeUndefined()
    expect(guardConfig({ ACCORD_UI_TOKEN: 'x', ACCORD_UI_HOSTS: '127.0.0.1:1, Localhost:1' })).toEqual({
      token: 'x',
      hosts: ['127.0.0.1:1', 'localhost:1'],
    })
  })

  it('lets the opened page through', () => {
    expect(guard(req(), config)).toEqual({ kind: 'next' })
    expect(guard(req({ host: 'localhost:4317' }), config)).toEqual({ kind: 'next' })
  })

  it('refuses a foreign host (DNS rebinding) even with the cookie', () => {
    expect(guard(req({ host: 'evil.example:4317' }), config)).toMatchObject({ kind: 'deny', status: 403 })
    expect(guard(req({ host: '127.0.0.1:9999' }), config)).toMatchObject({ kind: 'deny', reason: 'host' })
    expect(guard(req({ host: null }), config)).toMatchObject({ kind: 'deny', reason: 'host' })
  })

  it('refuses requests without the token or with a wrong one', () => {
    expect(guard(req({ cookie: undefined }), config)).toMatchObject({ kind: 'deny', status: 401 })
    expect(guard(req({ cookie: 'b'.repeat(43) }), config)).toMatchObject({ kind: 'deny', reason: 'token' })
    expect(guard(req({ cookie: 'short' }), config)).toMatchObject({ kind: 'deny', reason: 'token' })
  })

  it('turns the token in the address into a cookie and removes it from the address', () => {
    const result = guard(req({ cookie: undefined, path: `/p/shop?x=1&t=${config.token}` }), config)
    expect(result).toEqual({ kind: 'redirect', location: '/p/shop?x=1', cookie: config.token })
    expect(guard(req({ cookie: undefined, path: '/?t=wrong' }), config)).toMatchObject({ kind: 'deny' })
  })

  it('refuses writes from another origin, also with a valid cookie', () => {
    const post = (origin: string | null) => guard(req({ method: 'POST', origin }), config)
    expect(post('http://127.0.0.1:4317')).toEqual({ kind: 'next' })
    expect(post('https://evil.example')).toMatchObject({ kind: 'deny', reason: 'origin' })
    expect(post('http://localhost:4317')).toMatchObject({ kind: 'deny', reason: 'origin' })
    expect(post('null')).toMatchObject({ kind: 'deny', reason: 'origin' })
    expect(post('not a url')).toMatchObject({ kind: 'deny', reason: 'origin' })
  })

  it('does not accept the token from the address on a write', () => {
    const r = req({
      method: 'POST',
      origin: 'http://127.0.0.1:4317',
      cookie: undefined,
      path: `/?t=${config.token}`,
    })
    expect(guard(r, config)).toMatchObject({ kind: 'deny', reason: 'token' })
  })
})
