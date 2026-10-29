import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addedLines,
  checkChange,
  formatCheck,
  formatGithubAnnotations,
  formatMarkdownSummary,
} from '../src/check.js'
import { initCommand } from '../src/commands.js'
import { translator } from '../src/messages.js'

const fixture = fileURLToPath(new URL('./fixtures/shop', import.meta.url))

describe('addedLines', () => {
  it('reads added line numbers per file from a unified diff', () => {
    const diff = `diff --git a/src/a.tsx b/src/a.tsx
--- a/src/a.tsx
+++ b/src/a.tsx
@@ -10,3 +10,4 @@ export function A() {
   const x = 1
-  const old = '#000000'
+  const color = '#487a98'
+  const other = '#16222b'
   return x
@@ -40,0 +42,1 @@
+const late = '#ffffff'
--- a/src/gone.tsx
+++ /dev/null
@@ -1 +0,0 @@
-gone
`
    expect(Object.fromEntries([...addedLines(diff)].map(([f, l]) => [f, [...l]]))).toEqual({
      'src/a.tsx': [11, 12, 42],
    })
  })
})

describe('checkChange', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'accord-check-'))
    await cp(fixture, dir, { recursive: true })
    await initCommand(
      { root: dir, register: '.accord', force: false, dryRun: false },
      translator('de'),
      () => {},
    )
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('reports hard-coded colours with the replacement token and its CSS variable', async () => {
    const result = await checkChange({
      root: dir,
      registerDir: '.accord',
      paths: ['src/components/marketing/Hero.tsx'],
    })
    expect(result.ok).toBe(false)
    expect(result.findings.map((f) => [f.decision, f.value, f.replacement, f.replacementVar])).toEqual([
      ['D-001', '#487a98', 'color.brand.$root', '--brand-blue'],
      ['D-001', '#4a7d9b', 'color.brand.$root', '--brand-blue'],
    ])
    const text = formatCheck(result)
    expect(text).toContain('2 violation(s), 2 must – fix before committing')
    expect(text).toContain('src/components/marketing/Hero.tsx:2:')
    expect(text).toContain('→ color.brand.$root (var(--brand-blue))')
  })

  it('never reads files outside the project, from paths or from a diff', async () => {
    const diff = `--- a/../outside.tsx
+++ b/../outside.tsx
@@ -0,0 +1,1 @@
+const c = '#487a98'
`
    const result = await checkChange({
      root: dir,
      registerDir: '.accord',
      paths: ['../outside.tsx', join(tmpdir(), 'elsewhere.tsx'), 'src/../../x.tsx'],
      diff,
    })
    expect(result.files).toEqual([])
    expect(result.findings).toEqual([])
  })

  it('only counts added lines when a diff is given', async () => {
    const diff = `--- a/src/components/marketing/Hero.tsx
+++ b/src/components/marketing/Hero.tsx
@@ -1,1 +1,1 @@
-export function Hero() {
+export function Hero() {
`
    const result = await checkChange({ root: dir, registerDir: '.accord', diff })
    expect(result.files).toEqual(['src/components/marketing/Hero.tsx'])
    expect(result.findings).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('writes GitHub annotations at the line and a markdown summary', async () => {
    const result = await checkChange({
      root: dir,
      registerDir: '.accord',
      paths: ['src/components/marketing/Hero.tsx'],
    })
    const [first] = formatGithubAnnotations(result).split('\n')
    expect(first).toMatch(
      /^::error file=src\/components\/marketing\/Hero.tsx,line=2,col=\d+,title=D-001 \(must\)::/,
    )
    expect(first).toContain('Replace with color.brand.$root (var(--brand-blue)).')
    expect(formatGithubAnnotations(result, 'apps/shop')).toContain(
      'file=apps/shop/src/components/marketing/Hero.tsx,line=2',
    )
    const summary = formatMarkdownSummary(result)
    expect(summary).toContain('### ❌ decivo Accord')
    expect(summary).toContain('| D-001 (must) | `src/components/marketing/Hero.tsx:2:')
  })

  it('passes clean files', async () => {
    const result = await checkChange({
      root: dir,
      registerDir: '.accord',
      paths: ['src/components/ui/dialog.tsx'],
    })
    expect(formatCheck(result)).toBe('check_change: no violations in 1 file(s).')
  })
})
