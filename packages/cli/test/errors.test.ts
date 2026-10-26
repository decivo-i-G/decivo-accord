import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RegisterError } from '@decivo/accord-core/node'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkCommand, diffCommand, exportCommand, initCommand, penCommand } from '../src/commands.js'
import { AccordError, explainError } from '../src/errors.js'
import { git } from '../src/git.js'
import { detectLang, translator } from '../src/messages.js'

const fixture = fileURLToPath(new URL('./fixtures/shop', import.meta.url))
const t = translator('en')
const explain = (error: unknown, registerDir = '.accord') =>
  explainError(error, t, { registerDir, debug: false })

describe('errors people see', () => {
  let root = ''
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'accord-errors-'))
  })
  afterEach(() => rm(root, { recursive: true, force: true }))

  it('a missing register says to run accord init, without a stack trace', async () => {
    const error = await diffCommand({ root, register: '.accord', json: false, limit: 5 }, t, () => {}).catch(
      (e: unknown) => e,
    )
    const text = explain(error, join(root, '.accord'))
    expect(text).toContain('No register found')
    expect(text).toContain('accord init')
    expect(text).not.toContain('    at ')
  })

  it('a broken token file stops every check instead of passing on half a register', async () => {
    await cp(fixture, root, { recursive: true })
    await initCommand({ root, register: '.accord', force: false, dryRun: false }, t, () => {})
    await writeFile(join(root, '.accord', 'tokens', 'color.tokens.json'), '{ broken')
    const opts = { root, register: '.accord' }
    for (const run of [
      () => diffCommand({ ...opts, json: false, limit: 5 }, t, () => {}),
      () => checkCommand({ ...opts, paths: ['src/app/globals.css'], json: false }, () => {}),
      () => exportCommand({ ...opts, check: true }, t, () => {}),
      () => penCommand({ ...opts, action: 'status', json: false }, t, () => {}),
    ]) {
      const error = await run().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(RegisterError)
      expect(explain(error)).toMatch(/has 1 error\(s\)[\s\S]*tokens\/color\.tokens\.json/)
    }
  })

  it('an invalid config is an error, not silently replaced by defaults', async () => {
    await cp(fixture, root, { recursive: true })
    await initCommand({ root, register: '.accord', force: false, dryRun: false }, t, () => {})
    await writeFile(join(root, '.accord', 'accord.config.yaml'), 'version: 2\n')
    const error = await diffCommand({ root, register: '.accord', json: false, limit: 5 }, t, () => {}).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(RegisterError)
    expect(explain(error)).toContain('accord.config.yaml')
  })

  it('git failures name the step and git’s reason', async () => {
    const error = await git(root, ['checkout', '-b', 'x']).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AccordError)
    expect(explain(error)).toMatch(/^git checkout failed: not a git repository/)
  })

  it('missing files and unknown errors are explained, the stack only with ACCORD_DEBUG', () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT', path: '/x/decision.json' })
    expect(explain(enoent)).toBe('Not found: /x/decision.json')
    const boom = new Error('boom')
    expect(explain(boom)).toMatch(/^Unexpected error: boom\nSet ACCORD_DEBUG=1/)
    expect(explainError(boom, t, { registerDir: '.accord', debug: true })).toContain('    at ')
  })

  it('speaks German for German locales and English otherwise', () => {
    expect(detectLang({ LANG: 'de_DE.UTF-8' })).toBe('de')
    expect(detectLang({ LANG: 'fr_FR.UTF-8' })).toBe('en')
    expect(detectLang({})).toBe('en')
    expect(detectLang({ LANG: 'de_DE.UTF-8', ACCORD_LANG: 'en' })).toBe('en')
  })
})
