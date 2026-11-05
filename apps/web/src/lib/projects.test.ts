import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasRegister, listProjects } from './projects'

describe('projects', () => {
  it('reads ACCORD_PROJECTS and defaults the branch', () => {
    const env = { ACCORD_PROJECTS: '[{"slug":"shop","name":"acme/shop","root":"/x"}]' }
    expect(listProjects(env)).toEqual([{ slug: 'shop', name: 'acme/shop', root: '/x', branch: 'main' }])
    expect(listProjects({})).toEqual([])
  })

  it('knows whether a project has a register', () => {
    const root = mkdtempSync(join(tmpdir(), 'accord-projects-'))
    const project = { slug: 'p', name: 'p', root, branch: 'main' }
    expect(hasRegister(project)).toBe(false)
    mkdirSync(join(root, '.accord'))
    expect(hasRegister(project)).toBe(false)
    writeFileSync(join(root, '.accord', 'accord.config.yaml'), 'version: 1\n')
    expect(hasRegister(project)).toBe(true)
  })
})
