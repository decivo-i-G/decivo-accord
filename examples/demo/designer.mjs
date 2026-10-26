// Plays the designer: changes the Figma variables export the way a change in Figma would.
//   node designer.mjs set "Radius/Card" 16
//   node designer.mjs set "Blue/600" "#2a5d7c"
//   node designer.mjs delete "Spacing/4"
import { readFileSync, writeFileSync } from 'node:fs'

const [action, name, value] = process.argv.slice(2)
const file = 'figma/variables.json'
const doc = JSON.parse(readFileSync(file, 'utf8'))
const variables = doc.meta.variables
const [id, variable] = Object.entries(variables).find(([, v]) => v.name === name) ?? []
if (!variable) throw new Error(`no Figma variable "${name}"`)

if (action === 'delete') delete variables[id]
else if (action === 'set') {
  const hex = /^#[0-9a-f]{6}$/i.test(value)
  const parsed = hex
    ? Object.fromEntries(
        ['r', 'g', 'b'].map((c, i) => [c, Number.parseInt(value.slice(1 + 2 * i, 3 + 2 * i), 16) / 255]),
      )
    : Number(value)
  for (const mode of Object.keys(variable.valuesByMode))
    variable.valuesByMode[mode] = hex ? { ...parsed, a: 1 } : parsed
} else throw new Error('usage: node designer.mjs set <name> <value> | delete <name>')

writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`)
console.log(`Figma: ${action === 'delete' ? `deleted ${name}` : `${name} = ${value}`}`)
