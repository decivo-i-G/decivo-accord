import { type NextRequest, NextResponse } from 'next/server'
import { guard, guardConfig, UI_COOKIE } from '@/lib/ui-guard'

const DENIED = {
  host: 'decivo Accord antwortet nur unter der Adresse, die accord ui geöffnet hat.\ndecivo Accord answers only on the address accord ui opened.',
  origin:
    'decivo Accord nimmt Änderungen nur von der eigenen Seite an.\ndecivo Accord accepts changes only from its own page.',
  token:
    'Öffne diese Seite mit accord ui im Repository (die Adresse, die es ausgibt).\nOpen this page with accord ui in the repository (the address it prints).',
} as const

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
      cookie: request.cookies.get(UI_COOKIE)?.value,
    },
    config,
  )
  if (result.kind === 'next') return NextResponse.next()
  if (result.kind === 'deny')
    return new NextResponse(`${DENIED[result.reason]}\n`, {
      status: result.status,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  const response = NextResponse.redirect(new URL(result.location, request.nextUrl), 303)
  response.cookies.set(UI_COOKIE, result.cookie, { httpOnly: true, sameSite: 'strict', path: '/' })
  response.headers.set('cache-control', 'no-store')
  return response
}
