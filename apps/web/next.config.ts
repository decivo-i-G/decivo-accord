import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import { LEGACY_REDIRECTS } from './src/lib/routes'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const config: NextConfig = {
  output: 'standalone',
  // Type checking runs with the repository's TypeScript 7 (`pnpm typecheck`), not inside `next build`.
  typescript: { ignoreBuildErrors: true },
  // Accord packages read the file system and run git; they stay on the server and are not bundled.
  serverExternalPackages: [
    '@decivo/accord-adapter-claude-design',
    '@decivo/accord-adapter-code',
    '@decivo/accord-adapter-figma',
    '@decivo/accord-adapter-pen',
    '@decivo/accord-checks',
    '@decivo/accord-cli',
    '@decivo/accord-core',
    '@decivo/accord-generators',
  ],
  // Old addresses (Systemzustand, Vorschläge) lead to the new sections, with their query string.
  redirects: async () => LEGACY_REDIRECTS.map((r) => ({ ...r })),
}

export default withNextIntl(config)
