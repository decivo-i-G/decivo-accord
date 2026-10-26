import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

/** Database connection, or undefined when DATABASE_URL is not set (local mode without database). */
export function createDb(url: string | undefined = process.env.DATABASE_URL) {
  if (!url) return undefined
  return drizzle(postgres(url, { prepare: false }), { schema })
}

export type Db = NonNullable<ReturnType<typeof createDb>>
