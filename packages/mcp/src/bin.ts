#!/usr/bin/env node
import { resolve } from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createAccordServer } from './server.js'

/** `accord-mcp [--root <dir>] [--register <dir>]`; defaults: ACCORD_ROOT or the working directory, `.accord`. */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

const root = resolve(arg('--root') ?? process.env.ACCORD_ROOT ?? process.cwd())
const server = createAccordServer({
  root,
  registerDir: arg('--register') ?? process.env.ACCORD_REGISTER ?? '.accord',
})
await server.connect(new StdioServerTransport())
