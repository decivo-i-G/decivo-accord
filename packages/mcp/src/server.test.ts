import { readFileSync } from 'node:fs'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initCommand, translator } from '@decivo/accord-cli'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAccordServer, serverVersion } from './server.js'

const fixture = fileURLToPath(new URL('../../cli/test/fixtures/shop', import.meta.url))

describe('Accord MCP server', () => {
  let dir: string
  let client: Client

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'accord-mcp-'))
    await cp(fixture, dir, { recursive: true })
    await initCommand(
      { root: dir, register: '.accord', force: false, dryRun: false },
      translator('de'),
      () => {},
    )
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await createAccordServer({ root: dir }).connect(serverTransport)
    client = new Client({ name: 'test', version: '0.0.0' })
    await client.connect(clientTransport)
  })
  afterAll(async () => {
    await client.close()
    await rm(dir, { recursive: true, force: true })
  })

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args })
    return result as {
      content: { type: string; text: string }[]
      structuredContent?: Record<string, unknown>
      isError?: boolean
    }
  }

  it('lists the four read-only tools', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'check_change',
      'get_component_contract',
      'get_decisions',
      'get_tokens',
    ])
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true)
  })

  it('get_tokens returns values with the CSS variable to use', async () => {
    const result = await call('get_tokens', { scope: 'color.brand' })
    expect(result.structuredContent?.tokens).toEqual([
      expect.objectContaining({
        path: 'color.brand.700',
        value: '#3c6681',
        cssVariable: 'var(--brand-700)',
        owner: 'design',
      }),
      expect.objectContaining({
        path: 'color.brand.$root',
        value: '#487a98',
        cssVariable: 'var(--brand-blue)',
        description: 'Markenfarbe',
      }),
    ])
    expect((await call('get_tokens', { scope: 'nope' })).isError).toBe(true)
  })

  it('get_component_contract returns the contract or the known names', async () => {
    const result = await call('get_component_contract', { name: 'button' })
    expect(result.structuredContent?.contract).toMatchObject({
      name: 'Button',
      variants: { variant: ['default', 'ghost'] },
    })
    const missing = await call('get_component_contract', { name: 'Card' })
    expect(missing.isError).toBe(true)
    expect(missing.content[0]?.text).toContain('Known components: Button, Dialog')
  })

  it('get_decisions includes the reason and filters by token or file', async () => {
    const all = await call('get_decisions')
    const decisions = (all.structuredContent?.decisions ?? []) as { id: string }[]
    expect(decisions.map((d) => d.id)).toEqual(['D-001', 'D-002'])
    const forToken = await call('get_decisions', { scope: 'color.brand.700' })
    expect(forToken.structuredContent?.decisions).toEqual([
      expect.objectContaining({ id: 'D-002', why: expect.any(String) }),
    ])
    const forFile = await call('get_decisions', { scope: 'src/components/marketing/Hero.tsx' })
    expect(forFile.structuredContent?.decisions).toEqual([expect.objectContaining({ id: 'D-001' })])
  })

  it('check_change reports violations with replacements', async () => {
    const result = await call('check_change', { paths: ['src/components/marketing/Hero.tsx'] })
    expect(result.structuredContent?.ok).toBe(false)
    expect(result.content[0]?.text).toContain('D-001 (must)')
    expect(result.content[0]?.text).toContain('→ color.brand.$root (var(--brand-blue))')
    expect((await call('check_change', {})).isError).toBe(true)
  })
})

describe('Accord MCP server with light and dark', () => {
  let dir: string
  let client: Client

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'accord-mcp-modes-'))
    await cp(fileURLToPath(new URL('../../cli/test/fixtures/shadcn', import.meta.url)), dir, {
      recursive: true,
    })
    await initCommand(
      { root: dir, register: '.accord', force: false, dryRun: false },
      translator('en'),
      () => {},
    )
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await createAccordServer({ root: dir }).connect(serverTransport)
    client = new Client({ name: 'test', version: '0.0.0' })
    await client.connect(clientTransport)
  })
  afterAll(async () => {
    await client.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('get_tokens keeps value as the default context and adds the value per other context', async () => {
    const result = (await client.callTool({ name: 'get_tokens', arguments: { scope: 'color' } })) as {
      content: { text: string }[]
      structuredContent?: Record<string, unknown>
    }
    expect(result.structuredContent?.modes).toEqual({ default: 'light', contexts: ['light', 'dark'] })
    const tokens = result.structuredContent?.tokens as { path: string; value: string; contexts?: unknown }[]
    expect(tokens.find((t) => t.path === 'color.background')).toMatchObject({
      value: '#ffffff',
      contexts: { dark: '#0a0a0a' },
      cssVariable: 'var(--background)',
    })
    // The text is still the list of tokens it always was.
    expect(Array.isArray(JSON.parse(result.content[0]?.text ?? ''))).toBe(true)
  })
})

describe('serverVersion', () => {
  it('reports the version of the package, not a placeholder', async () => {
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(serverVersion()).toBe(version)
    expect(serverVersion()).not.toBe('0.0.0')
  })
})
