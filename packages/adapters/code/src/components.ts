import { parse as parseScript } from '@babel/parser'

/** A component module as far as it can be read without running it. */
export interface ComponentModule {
  file: string
  /** Exported PascalCase names, in source order. */
  exports: string[]
  /** `cva()` variant axes by the variable they are assigned to, e.g. `buttonVariants`. */
  variants: Record<string, Record<string, string[]>>
  /** `defaultVariants` of each `cva()` call. */
  defaults: Record<string, Record<string, string>>
}

type Node = { type: string; [key: string]: unknown }
const isNode = (v: unknown): v is Node =>
  typeof v === 'object' && v !== null && typeof (v as Node).type === 'string'
const isPascal = (name: string) => /^[A-Z][A-Za-z0-9]*$/.test(name)

function keyName(key: Node): string | undefined {
  if (key.type === 'Identifier') return key.name as string
  if (key.type === 'StringLiteral' || key.type === 'NumericLiteral') return String(key.value)
  return undefined
}

function objectEntries(node: Node | undefined): [string, Node][] {
  if (node?.type !== 'ObjectExpression') return []
  const out: [string, Node][] = []
  for (const prop of node.properties as Node[]) {
    if (prop.type !== 'ObjectProperty') continue
    const name = keyName(prop.key as Node)
    if (name !== undefined) out.push([name, prop.value as Node])
  }
  return out
}

/** Read exports and `class-variance-authority` variants from a component file (shadcn/ui style). */
export function readComponentModule(code: string, file: string): ComponentModule {
  const result: ComponentModule = { file, exports: [], variants: {}, defaults: {} }
  let program: Node
  try {
    program = (
      parseScript(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
        errorRecovery: true,
      }) as unknown as { program: Node }
    ).program
  } catch {
    return result
  }

  const addExport = (name: string) => {
    if (isPascal(name) && !result.exports.includes(name)) result.exports.push(name)
  }

  const visit = (node: Node): void => {
    if (node.type === 'VariableDeclarator') {
      const id = node.id as Node
      const init = node.init as Node | null
      if (id.type === 'Identifier' && init?.type === 'CallExpression') {
        const callee = init.callee as Node
        const args = init.arguments as Node[]
        if (callee.type === 'Identifier' && callee.name === 'cva' && args[1]) {
          const config = Object.fromEntries(objectEntries(args[1]))
          const axes: Record<string, string[]> = {}
          for (const [axis, options] of objectEntries(config.variants))
            axes[axis] = objectEntries(options).map(([o]) => o)
          const defaults: Record<string, string> = {}
          for (const [axis, value] of objectEntries(config.defaultVariants)) {
            if (value.type === 'StringLiteral') defaults[axis] = value.value as string
          }
          result.variants[id.name as string] = axes
          result.defaults[id.name as string] = defaults
        }
      }
    }
    if (node.type === 'ExportNamedDeclaration') {
      const decl = node.declaration as Node | null
      if (decl?.type === 'FunctionDeclaration' && isNode(decl.id)) addExport(decl.id.name as string)
      if (decl?.type === 'VariableDeclaration') {
        for (const d of decl.declarations as Node[])
          if ((d.id as Node).type === 'Identifier') addExport((d.id as Node).name as string)
      }
      for (const spec of (node.specifiers as Node[]) ?? []) {
        const exported = spec.exported as Node
        const name = keyName(exported)
        if (name) addExport(name)
      }
    }
    if (node.type === 'ExportDefaultDeclaration') {
      const decl = node.declaration as Node
      if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && isNode(decl.id))
        addExport(decl.id.name as string)
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue
      if (Array.isArray(child)) for (const c of child) isNode(c) && visit(c)
      else if (isNode(child)) visit(child)
    }
  }
  visit(program)
  return result
}

/** `buttonVariants` → `Button`. */
export const componentForVariants = (variable: string) =>
  variable.replace(/Variants$/, '').replace(/^./, (c) => c.toUpperCase())
