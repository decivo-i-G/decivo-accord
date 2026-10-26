import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createDb } from '@/db/client'
import * as schema from '@/db/schema'

/**
 * Sign-in with GitHub. Only active when database and GitHub credentials are configured; without them the
 * app runs in local mode (projects from ACCORD_PROJECTS, no accounts). Secrets come from the environment only.
 */
function createAuth() {
  const db = createDb()
  const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, BETTER_AUTH_SECRET } = process.env
  if (!db || !GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !BETTER_AUTH_SECRET) return undefined
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    socialProviders: { github: { clientId: GITHUB_CLIENT_ID, clientSecret: GITHUB_CLIENT_SECRET } },
    telemetry: { enabled: false },
  })
}

export const auth = createAuth()
export const authEnabled = auth !== undefined
