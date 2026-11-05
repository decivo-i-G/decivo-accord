/**
 * Loaded into the app server before Next starts (`node --import`). Two jobs:
 * - receive one-time codes from `accord ui` over the IPC channel; the guard in the app (proxy) reads them
 *   from the same process-wide state;
 * - end the server with `accord ui`. The IPC channel closes when that process ends in any way, also with
 *   SIGKILL or a crash, so no server is left behind that can write into the repository.
 */
interface GuardState {
  codes: Set<string>
  sessions: Set<string>
}
const KEY = Symbol.for('decivo.accord.ui.guard')
const g = globalThis as { [KEY]?: GuardState }
g[KEY] ??= { codes: new Set(), sessions: new Set() }
const state = g[KEY]

process.on('message', (message: unknown) => {
  const m = message as { type?: unknown; code?: unknown } | null
  if (m && m.type === 'code' && typeof m.code === 'string' && m.code.length >= 32) state.codes.add(m.code)
})
process.on('disconnect', () => process.exit(0))
