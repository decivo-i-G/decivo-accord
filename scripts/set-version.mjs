#!/usr/bin/env node
// Lockstep versions for the public packages.
//   node scripts/set-version.mjs 0.1.0          set every public package to 0.1.0
//   node scripts/set-version.mjs --check 0.1.0  exit 1 unless every public package is at 0.1.0
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const check = process.argv[2] === '--check'
const version = process.argv[check ? 3 : 2]
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
  console.error('usage: set-version.mjs [--check] <major.minor.patch>')
  process.exit(2)
}
const files = ['packages', 'packages/adapters']
  .flatMap((d) => readdirSync(join(root, d)).map((n) => join(root, d, n, 'package.json')))
  .filter((f) => existsSync(f))
let wrong = 0
for (const file of files) {
  const json = JSON.parse(readFileSync(file, 'utf8'))
  if (json.private) continue
  if (check) {
    if (json.version !== version) {
      console.error(`${json.name} is ${json.version}, expected ${version}`)
      wrong++
    }
  } else {
    json.version = version
    writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`)
    console.log(`${json.name} ${version}`)
  }
}
process.exit(wrong ? 1 : 0)
