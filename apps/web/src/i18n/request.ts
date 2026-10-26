import { cookies, headers } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'

export const LOCALES = ['de', 'en'] as const
export type Locale = (typeof LOCALES)[number]

/** German first; English when the user chose it (cookie) or the browser prefers it and no choice was made. */
export async function resolveLocale(): Promise<Locale> {
  const chosen = (await cookies()).get('locale')?.value
  if (chosen === 'de' || chosen === 'en') return chosen
  const accept = (await headers()).get('accept-language') ?? ''
  return /^en\b/i.test(accept) ? 'en' : 'de'
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale()
  return { locale, messages: (await import(`../../messages/${locale}.json`)).default }
})
