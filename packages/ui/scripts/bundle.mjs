#!/usr/bin/env node
// Packs the built web app (apps/web, `output: 'standalone'`) into packages/ui/app so it ships on npm:
//   node scripts/bundle.mjs
// npm keeps nested node_modules but drops symbolic links, and pnpm's standalone output is made of them.
// So the runtime packages are copied flat and real; native image libraries (sharp) stay out, the app
// does not optimise images. Accord's own packages are not copied: they are dependencies of this package.
import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = join(here, '..')
const repo = join(pkg, '..', '..')
const web = join(repo, 'apps', 'web')
const standalone = join(web, '.next', 'standalone')
const builtApp = join(standalone, 'apps', 'web')
const out = join(pkg, 'app')

const fail = (msg) => {
  console.error(`bundle: ${msg}`)
  process.exit(1)
}
if (!existsSync(join(builtApp, 'server.js')))
  fail('apps/web is not built (pnpm --filter @decivo/accord-web build)')

rmSync(out, { recursive: true, force: true })

// 1. The server and its build, without sources, tests and the build cache.
cpSync(join(builtApp, 'server.js'), join(out, 'server.js'))
cpSync(join(builtApp, 'package.json'), join(out, 'package.json'))
cpSync(join(builtApp, '.next'), join(out, '.next'), {
  recursive: true,
  dereference: true, // turbopack links externals as .next/node_modules/<name>-<hash>
  filter: (src) => !src.includes(`${join('.next', 'cache')}`),
})
cpSync(join(web, '.next', 'static'), join(out, '.next', 'static'), { recursive: true })
if (existsSync(join(web, 'public'))) cpSync(join(web, 'public'), join(out, 'public'), { recursive: true })

// 2. Runtime packages from the pnpm store, flat.
const SKIP = /^(sharp|@img\/|@decivo\/)/
const store = join(standalone, 'node_modules', '.pnpm')
const seen = new Map()
for (const entry of readdirSync(store)) {
  const modules = join(store, entry, 'node_modules')
  if (!existsSync(modules)) continue
  for (const name of readdirSync(modules)) {
    const names = name.startsWith('@') ? readdirSync(join(modules, name)).map((s) => `${name}/${s}`) : [name]
    for (const n of names) {
      const src = join(modules, n)
      if (lstatSync(src).isSymbolicLink() || SKIP.test(n)) continue
      const { version } = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'))
      const known = seen.get(n)
      if (known && known !== version)
        fail(`${n} is needed in ${known} and ${version}; a flat copy cannot hold both`)
      if (known) continue
      seen.set(n, version)
      cpSync(src, join(out, 'node_modules', n), { recursive: true, dereference: true })
    }
  }
}

// 3. The build machine's paths (tracing roots) mean nothing on the user's machine.
const prefix = JSON.stringify(repo).slice(1, -1)
for (const file of [join(out, 'server.js'), join(out, '.next', 'required-server-files.json')]) {
  if (!existsSync(file)) continue
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll(prefix, '.'))
}

console.log(`bundle: app/ with ${[...seen].map(([n, v]) => `${n}@${v}`).join(', ')}`)
