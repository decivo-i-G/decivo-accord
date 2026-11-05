#!/usr/bin/env node
import { startUi } from './index.js'

/** `accord-ui [folder …] [--port <n>] [--no-open]`; `accord ui` in the CLI starts the same. */
const args = process.argv.slice(2)
const roots: string[] = []
let port: number | undefined
let open = true
for (let i = 0; i < args.length; i++) {
  const a = args[i] as string
  if (a === '--no-open') open = false
  else if (a === '--port') port = Number(args[++i])
  else if (a.startsWith('--port=')) port = Number(a.slice(7))
  else if (a === '-h' || a === '--help') {
    console.log('accord-ui [folder …] [--port <n>] [--no-open]')
    process.exit(0)
  } else roots.push(a)
}
if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) {
  console.error('accord-ui: --port needs a number between 1 and 65535')
  process.exit(2)
}

const de = /^de/i.test(process.env.ACCORD_LANG ?? process.env.LC_ALL ?? process.env.LANG ?? '')
try {
  const ui = await startUi({ roots, port, open })
  const names = ui.projects.map((p) => p.name).join(', ')
  console.log(
    de
      ? `decivo Accord · ${names}\n  ${ui.url}\n  Nur auf diesem Rechner. Strg+C beendet.`
      : `decivo Accord · ${names}\n  ${ui.url}\n  Only on this machine. Ctrl+C stops it.`,
  )
  const stop = () => {
    ui.stop()
    process.exit(0)
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, stop)
  const code = await ui.exited
  process.exit(code ?? 0)
} catch (error) {
  console.error(`accord-ui: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
