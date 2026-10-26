import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/lib/auth'

const notConfigured = () => new Response('Sign-in is not configured.', { status: 404 })
const handlers = auth ? toNextJsHandler(auth) : { GET: notConfigured, POST: notConfigured }

export const { GET, POST } = handlers
