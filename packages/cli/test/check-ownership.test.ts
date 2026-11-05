import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { checkChange, formatCheck } from '../src/check.js'
import { initCommand } from '../src/commands.js'
import { translator } from '../src/messages.js'

/** `check` is the agents' gate before a commit: it must not wave through what code may not decide. */
const demo = fileURLToPath(new URL('../../../examples/demo/project', import.meta.url))

describe('check: ownership', () => {
  let root = ''
  const styles = () => join(root, 'src', 'styles.css')
  const edit = async (fn: (css: string) => string) =>
    writeFile(styles(), fn(await readFile(styles(), 'utf8')))
  const check = (paths = ['src/styles.css']) => checkChange({ root, registerDir: '.accord', paths })

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'accord-check-owner-'))
    await cp(demo, root, { recursive: true })
    execFileSync('git', ['init', '-q'], { cwd: root })
    await initCommand(
      { root, register: '.accord', force: false, dryRun: false, figma: ['figma/variables.json'] },
      translator('en'),
      () => {},
    )
  })

  it('passes an untouched stylesheet', async () => {
    const result = await check()
    expect(result.ok).toBe(true)
    expect(result.ownership).toEqual([])
  })

  it('reports a design value changed in code, with its owner', async () => {
    await edit((css) => css.replace('--brand: #3c6681', '--brand: #2f5a74'))
    const result = await check()
    expect(result.ok).toBe(false)
    expect(result.ownership).toEqual([
      expect.objectContaining({ token: 'color.brand', kind: 'changed', owner: 'design', after: '#2f5a74' }),
    ])
    expect(formatCheck(result)).toMatch(/owned by design/)
  })

  it('reports a linked CSS variable removed from code as a deletion', async () => {
    await edit((css) =>
      css
        .split('\n')
        .filter((l) => !l.includes('--radius-card'))
        .join('\n'),
    )
    const result = await check()
    expect(result.ok).toBe(false)
    expect(result.ownership).toEqual([
      expect.objectContaining({ token: 'radius.card', kind: 'removed', variable: '--radius-card' }),
    ])
  })

  it('suggests only CSS variables code really defines', async () => {
    // blue.700 has no variable in this stylesheet; --blue-700 would be a name from the convention only.
    await writeFile(join(root, 'src', 'x.css'), '.a { color: #2f5a74; }\n.b { color: #3c6681; }\n')
    const { findings } = await check(['src/x.css'])
    const byValue = new Map(findings.map((f) => [f.value, f]))
    expect(byValue.get('#3c6681')?.replacementVar).toBe('--brand')
    expect(byValue.get('#2f5a74')?.replacement).toBe('blue.700')
    expect(byValue.get('#2f5a74')?.replacementVar).toBeUndefined()
  })
})
