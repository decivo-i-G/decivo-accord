import { type NextRequest, NextResponse } from 'next/server'
import { guard, guardConfig, guardState } from '@/lib/ui-guard'

const DENIED = {
  host: 'decivo Accord antwortet nur unter der Adresse, die accord ui geöffnet hat.\ndecivo Accord answers only on the address accord ui opened.',
  origin:
    'decivo Accord nimmt Änderungen nur von der eigenen Seite an.\ndecivo Accord accepts changes only from its own page.',
  token:
    'Öffne diese Seite mit accord ui im Repository (die Adresse, die es ausgibt).\nOpen this page with accord ui in the repository (the address it prints).',
  used: 'Diese Adresse wurde schon benutzt. Für eine neue drück Enter im Terminal von accord ui.\nThis address was used already. Press Enter in the accord ui terminal for a new one.',
} as const

/** Headers on every answer of the local app: no framing by other pages, no address in a Referer. */
function harden(response: NextResponse, instance: string): NextResponse {
  response.headers.set('x-frame-options', 'DENY')
  response.headers.set('content-security-policy', "frame-ancestors 'none'")
  response.headers.set('referrer-policy', 'no-referrer')
  response.headers.set('x-accord-ui', instance)
  return response
}

/** Runs before every request; only active when `accord ui` started the app (see `lib/ui-guard.ts`). */
export function proxy(request: NextRequest) {
  const config = guardConfig()
  if (!config) return NextResponse.next()
  const result = guard(
    {
      method: request.method,
      url: request.nextUrl,
      host: request.headers.get('host'),
      origin: request.headers.get('origin'),
      cookie: request.cookies.get(config.cookie)?.value,
    },
    config,
    guardState(),
  )
  if (result.kind === 'next') return harden(NextResponse.next(), config.instance)
  if (result.kind === 'deny')
    return harden(
      new NextResponse(`${DENIED[result.reason]}\n`, {
        status: result.status,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      }),
      config.instance,
    )
  const response = NextResponse.redirect(new URL(result.location, request.nextUrl), 303)
  response.cookies.set(config.cookie, result.session, { httpOnly: true, sameSite: 'strict', path: '/' })
  response.headers.set('cache-control', 'no-store')
  return harden(response, config.instance)
}
