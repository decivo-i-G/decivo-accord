#!/usr/bin/env node
// Release check: packs every public package exactly as npm would get it, inspects the tarballs, installs them
// into an empty project and runs Accord there with the network blocked. It builds from a clean dist itself:
//   node scripts/release-check.mjs [--keep]
// Exit code 0 when the release is clean, 1 with a list of problems.
import { execFileSync, spawn } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const keep = process.argv.includes('--keep')
const work = mkdtempSync(join(tmpdir(), 'accord-release-'))
const problems = []
const fail = (msg) => problems.push(msg)
const ok = (msg) => console.log(`  ok  ${msg}`)
const section = (title) => console.log(`\n${title}`)
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })

// Nothing internal may ship: decivo's own product, local paths, credentials.
const FORBIDDEN = [
  { re: /\bmind\b|decivo[ -]mind|MIND_/i, what: 'decivo Mind' },
  { re: /\/home\/[a-z]+\/|\/tmp\/claude|\/Users\/[A-Za-z]+\//, what: 'a local path' },
  {
    re: /\b(ghp_|github_pat_|npm_)[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY/,
    what: 'a credential',
  },
]
const ALLOWED_FILE = /^package\/(package\.json|README(\.de)?\.md|LICENSE|CHANGELOG\.md|dist\/.+)$/

section('1. Packages')
const workspaces = ['packages', 'packages/adapters']
  .flatMap((d) => readdirSync(join(root, d)).map((n) => join(root, d, n)))
  .filter((d) => existsSync(join(d, 'package.json')))
const packages = workspaces
  .map((dir) => ({ dir, json: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) }))
  .filter((p) => !p.json.private)
const versions = new Set(packages.map((p) => p.json.version))
if (versions.size !== 1) fail(`versions differ (lockstep expected): ${[...versions].join(', ')}`)
for (const { json } of packages) {
  const where = json.name
  if (json.license !== 'MIT') fail(`${where}: license is ${json.license}, expected MIT`)
  if (!json.repository?.url) fail(`${where}: no repository`)
  if (!json.engines?.node) fail(`${where}: no engines.node`)
  if (!json.description || /[äöüß]/.test(json.description))
    fail(`${where}: description missing or not English`)
  if (!json.publishConfig?.access)
    fail(`${where}: no publishConfig.access (scoped packages are private by default)`)
}
ok(`${packages.length} public packages: ${packages.map((p) => p.json.name).join(', ')}`)

section('2. Tarballs')
// Build from a clean dist: a file left over from an earlier build (a renamed module) must not ship.
for (const p of packages) rmSync(join(p.dir, 'dist'), { recursive: true, force: true })
run('pnpm', ['build', '--force'], { cwd: root })
ok('clean build')
const tarballs = join(work, 'tarballs')
mkdirSync(tarballs)
for (const p of packages) {
  const out = run('pnpm', ['pack', '--pack-destination', tarballs], { cwd: p.dir }).trim().split('\n').pop()
  p.tarball = out.startsWith('/') ? out : join(tarballs, out)
  const extract = join(work, 'extract', p.json.name.replace('/', '__'))
  mkdirSync(extract, { recursive: true })
  run('tar', ['-xzf', p.tarball, '-C', extract])
  const files = []
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n)
      statSync(f).isDirectory() ? walk(f) : files.push(f)
    }
  }
  walk(extract)
  const rel = files.map((f) => relative(extract, f))
  for (const f of rel) if (!ALLOWED_FILE.test(f)) fail(`${p.json.name}: unexpected file ${f}`)
  for (const f of rel)
    if (/\.test\.|__tests__|fixtures?\//.test(f)) fail(`${p.json.name}: test file shipped: ${f}`)
  for (const need of ['package/LICENSE', 'package/README.md'])
    if (!rel.includes(need)) fail(`${p.json.name}: ${need.slice(8)} missing`)
  const readme = rel.includes('package/README.md')
    ? readFileSync(join(extract, 'package/README.md'), 'utf8')
    : ''
  if (/\]\(\.\.?\//.test(readme)) fail(`${p.json.name}: README has relative links, which break on npmjs.com`)
  const shipped = JSON.parse(readFileSync(join(extract, 'package', 'package.json'), 'utf8'))
  const deps = { ...shipped.dependencies, ...shipped.peerDependencies }
  for (const [name, range] of Object.entries(deps))
    if (String(range).startsWith('workspace:')) fail(`${p.json.name}: dependency ${name} still ${range}`)
  for (const bin of Object.values(
    typeof shipped.bin === 'string' ? { x: shipped.bin } : (shipped.bin ?? {}),
  )) {
    const file = join(extract, 'package', bin)
    if (!existsSync(file)) fail(`${p.json.name}: bin ${bin} missing`)
    else if (!readFileSync(file, 'utf8').startsWith('#!/usr/bin/env node'))
      fail(`${p.json.name}: bin ${bin} has no shebang`)
  }
  // Every bare import in dist must be a declared dependency (a devDependency is not installed for users).
  const declared = new Set([...Object.keys(deps), ...Object.keys(shipped.optionalDependencies ?? {})])
  const missing = new Set()
  let size = 0
  for (const f of files) {
    size += statSync(f).size
    const text = readFileSync(f, 'utf8')
    for (const { re, what } of FORBIDDEN) {
      const m = text.match(re)
      if (m && !/^mind(est|\.)/i.test(text.slice(m.index, m.index + 7)))
        fail(
          `${p.json.name}: ${what} in ${relative(extract, f)}: "${text.slice(Math.max(0, m.index - 30), m.index + 40).replace(/\s+/g, ' ')}"`,
        )
    }
    if (!f.endsWith('.js')) continue
    for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"./][^'"]*)['"]/g)) {
      const spec = m[1]
      if (spec.startsWith('node:')) continue
      const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
      if (!declared.has(name)) missing.add(name)
    }
  }
  for (const name of missing) fail(`${p.json.name}: dist imports ${name}, which is not a dependency`)
  ok(`${p.json.name}: ${rel.length} files, ${(size / 1024).toFixed(0)} KB`)
}

section('3. Install into an empty project')
const app = join(work, 'app')
mkdirSync(app)
writeFileSync(
  join(app, 'package.json'),
  JSON.stringify({ name: 'release-check', private: true, type: 'module' }),
)
try {
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', ...packages.map((p) => p.tarball)], {
    cwd: app,
  })
  ok('npm install of all tarballs')
} catch (error) {
  fail(`npm install failed: ${error.stderr || error.message}`)
}

// From here on the network is blocked: Accord must work on its own.
const offline = {
  ...process.env,
  HTTPS_PROXY: 'http://127.0.0.1:9',
  HTTP_PROXY: 'http://127.0.0.1:9',
  https_proxy: 'http://127.0.0.1:9',
  http_proxy: 'http://127.0.0.1:9',
  NO_PROXY: '',
  no_proxy: '',
  NODE_OPTIONS: `--import=${join(work, 'no-network.mjs')}`,
  ACCORD_LANG: 'en',
}
// Fail any outgoing connection instead of relying on proxies alone.
writeFileSync(
  join(work, 'no-network.mjs'),
  `import net from 'node:net'
const block = () => { throw new Error('release-check: network access attempted') }
net.Socket.prototype.connect = block
globalThis.fetch = async () => block()
`,
)
const bin = join(app, 'node_modules', '.bin')

section('4. Accord without network')
if (existsSync(join(bin, 'accord'))) {
  try {
    const v = run(join(bin, 'accord'), ['--version'], { env: offline }).trim()
    ok(`accord --version: ${v}`)
  } catch (error) {
    fail(`accord --version failed: ${error.stderr || error.message}`)
  }
  // The five-minute demo, with the installed CLI instead of the workspace build.
  const demo = join(work, 'examples', 'demo')
  cpSync(join(root, 'examples', 'demo'), demo, { recursive: true })
  try {
    const out = run('bash', [join(demo, 'run.sh')], {
      env: { ...offline, PATH: `${bin}:${process.env.PATH}` },
    })
    for (const expect of [
      'Start source: Figma',
      'D-001',
      'can be applied automatically',
      'D-002',
      'deleted in Figma',
    ]) {
      if (!out.includes(expect)) fail(`demo output lacks "${expect}"`)
    }
    if (/release-check: network access attempted/.test(out)) fail('the demo tried to reach the network')
    ok('demo (init, check, explain-owner, figma status/propose, apply, export) offline')
  } catch (error) {
    fail(`demo failed: ${(error.stdout || '').slice(-2000)}${error.stderr || error.message}`)
  }
} else fail('no accord binary after install')

section('5. MCP server without network')
if (existsSync(join(bin, 'accord-mcp'))) {
  const project = join(work, 'examples', 'demo', 'project')
  const tools = await new Promise((resolve) => {
    const child = spawn(join(bin, 'accord-mcp'), ['--root', project], { env: offline })
    let buffer = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve(`timeout; stderr so far`)
    }, 15000)
    child.stdout.on('data', (d) => {
      buffer += d
      for (const line of buffer.split('\n').filter(Boolean)) {
        try {
          const msg = JSON.parse(line)
          if (msg.id === 2) {
            clearTimeout(timer)
            child.kill()
            resolve(msg.result?.tools?.map((t) => t.name) ?? `error: ${JSON.stringify(msg.error)}`)
          }
        } catch {}
      }
    })
    const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`)
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'release-check', version: '0' },
      },
    })
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  })
  const expected = ['get_tokens', 'get_component_contract', 'get_decisions', 'check_change']
  if (!Array.isArray(tools)) fail(`accord-mcp: ${tools}`)
  else if (expected.some((t) => !tools.includes(t))) fail(`accord-mcp tools: ${tools.join(', ')}`)
  else ok(`accord-mcp lists ${tools.join(', ')}`)
} else fail('no accord-mcp binary after install')

section('6. Public repository files')
const tracked = run('git', ['ls-files'], { cwd: root }).split('\n').filter(Boolean)
const publicDocs = tracked.filter(
  (f) => /\.(md|ya?ml|json|ts|tsx|mjs|js|sh|css)$/.test(f) && f !== 'scripts/release-check.mjs',
)
for (const f of publicDocs) {
  const text = readFileSync(join(root, f), 'utf8')
  for (const { re, what } of FORBIDDEN) {
    const m = text.match(re)
    if (m && !/^mind(est|\.)/i.test(text.slice(m.index, m.index + 7)))
      fail(
        `repository: ${what} in ${f}: "${text.slice(Math.max(0, m.index - 30), m.index + 40).replace(/\s+/g, ' ')}"`,
      )
  }
}
for (const f of tracked) if (/(^|\/)\.env(\.|$)(?!example)/.test(f)) fail(`repository: ${f} is tracked`)
ok(`${publicDocs.length} tracked files scanned`)

if (!keep) rmSync(work, { recursive: true, force: true })
else console.log(`\nKept: ${work}`)
console.log(
  problems.length
    ? `\n${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`
    : '\nRelease check passed.',
)
process.exit(problems.length ? 1 : 0)
