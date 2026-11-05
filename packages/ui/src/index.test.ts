import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { choosePort, projectsFor, serverEnv, slugOf } from './index.js'

describe('accord ui', () => {
  it('makes URL-safe, unique project slugs', () => {
    expect(slugOf('Acme Shop', new Set())).toBe('acme-shop')
    expect(slugOf('Café_Ü', new Set())).toBe('cafe-u')
    expect(slugOf('...', new Set())).toBe('project')
    expect(slugOf('shop', new Set(['shop', 'shop-2']))).toBe('shop-3')
  })

  it('shows the repository root, once, for folders inside it', () => {
    const repo = mkdtempSync(join(tmpdir(), 'accord-ui-'))
    execFileSync('git', ['init', '-q', '-b', 'trunk'], { cwd: repo })
    mkdirSync(join(repo, 'src'))
    const projects = projectsFor([repo, join(repo, 'src')])
    expect(projects).toHaveLength(1)
    expect(projects[0]).toMatchObject({ branch: 'trunk' })
    expect(projects[0]?.root.endsWith(projects[0]?.name ?? '?')).toBe(true)
    expect(() => projectsFor([join(repo, 'missing')])).toThrow(/does not exist/)
  })

  it('takes the next free port, and refuses a busy one that was asked for', async () => {
    const busy = createServer()
    await new Promise<void>((r) => busy.listen(0, '127.0.0.1', () => r()))
    const port = (busy.address() as { port: number }).port
    await expect(choosePort(port)).rejects.toThrow(/in use/)
    busy.close()
    expect(await choosePort()).toBeGreaterThanOrEqual(4317)
  })

  it('always runs the app in local mode on 127.0.0.1 with the guard on', () => {
    const env = serverEnv(
      {
        PATH: '/bin',
        DATABASE_URL: 'postgres://x',
        GITHUB_CLIENT_SECRET: 's',
        ACCORD_UI_TOKEN: 'old',
        PORT: '1',
      },
      { port: 4318, token: 'tok', projects: [{ slug: 's', name: 's', root: '/r', branch: 'main' }] },
    )
    expect(env).toMatchObject({
      PATH: '/bin',
      PORT: '4318',
      HOSTNAME: '127.0.0.1',
      ACCORD_UI_TOKEN: 'tok',
      ACCORD_UI_HOSTS: '127.0.0.1:4318,localhost:4318',
    })
    expect(env.DATABASE_URL).toBeUndefined()
    expect(env.GITHUB_CLIENT_SECRET).toBeUndefined()
    expect(JSON.parse(env.ACCORD_PROJECTS ?? '[]')).toHaveLength(1)
  })
})
