// decivo v6 type, self-hosted (no request to Google at runtime): Merriweather 300 for headings,
// IBM Plex Sans for the interface, IBM Plex Mono only for values and code.
import '@fontsource/merriweather/latin-300.css'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './globals.css'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { ToastProvider } from '@/components/toast'
import { THEME_COOKIE, themeFrom } from '@/lib/theme'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app')
  // Pages give `item · section · project`; the product name always comes last.
  return { title: { default: 'decivo Accord', template: '%s · decivo Accord' }, description: t('tagline') }
}

/** Light unless the settings stored Dark or System; set on <html> here, so there is no flash. */
async function themeOf() {
  return themeFrom((await cookies()).get(THEME_COOKIE)?.value)
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [locale, t, theme] = await Promise.all([getLocale(), getTranslations('app'), themeOf()])
  return (
    <html lang={locale} data-theme={theme}>
      <body>
        <a className="skip-link" href="#main">
          {t('skip')}
        </a>
        <NextIntlClientProvider>
          <ToastProvider>{children}</ToastProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
