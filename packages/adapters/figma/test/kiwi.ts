import zlib from 'node:zlib'

/**
 * A minimal kiwi encoder for tests: builds `.fig` files with exactly the nodes a test needs, in the
 * same container format Figma writes (`fig-kiwi`, version, deflated schema and message, ZIP around it).
 */
type Kind = 'enum' | 'struct' | 'message'
export interface Def {
  name: string
  kind: Kind
  /** [name, type, isArray?] in field order; message field values are their position + 1. */
  fields: [string, string, boolean?][]
}

const BUILTIN = ['bool', 'byte', 'int', 'uint', 'float', 'string', 'int64', 'uint64']
const KIND: Record<Kind, number> = { enum: 0, struct: 1, message: 2 }

class Writer {
  out: number[] = []
  byte(v: number) {
    this.out.push(v & 255)
  }
  uint(v: number) {
    let x = v >>> 0
    do {
      const b = x & 127
      x >>>= 7
      this.byte(x ? b | 128 : b)
    } while (x)
  }
  int(v: number) {
    this.uint((v << 1) ^ (v >> 31))
  }
  string(s: string) {
    for (const b of new TextEncoder().encode(s)) this.byte(b)
    this.byte(0)
  }
  float(v: number) {
    const view = new DataView(new ArrayBuffer(4))
    view.setFloat32(0, v)
    let bits = view.getInt32(0)
    if (bits === 0) return this.byte(0)
    bits = (bits >>> 23) | (bits << 9)
    for (let i = 0; i < 4; i++) this.byte(bits >>> (8 * i))
  }
}

const typeIndex = (defs: Def[], type: string) =>
  BUILTIN.includes(type) ? ~BUILTIN.indexOf(type) : defs.findIndex((d) => d.name === type)

export function encodeSchema(defs: Def[]): Uint8Array {
  const w = new Writer()
  w.uint(defs.length)
  for (const d of defs) {
    w.string(d.name)
    w.byte(KIND[d.kind])
    w.uint(d.fields.length)
    d.fields.forEach(([name, type, isArray], i) => {
      w.string(name)
      w.int(d.kind === 'enum' ? 0 : typeIndex(defs, type))
      w.byte(isArray ? 1 : 0)
      w.uint(d.kind === 'enum' ? Number(type) : i + 1)
    })
  }
  return Uint8Array.from(w.out)
}

export function encodeMessage(defs: Def[], root: string, value: unknown): Uint8Array {
  const w = new Writer()
  const write = (type: string, v: unknown) => {
    if (BUILTIN.includes(type)) {
      if (type === 'bool') w.byte(v ? 1 : 0)
      else if (type === 'byte') w.byte(v as number)
      else if (type === 'int') w.int(v as number)
      else if (type === 'uint') w.uint(v as number)
      else if (type === 'float') w.float(v as number)
      else if (type === 'string') w.string(v as string)
      return
    }
    const def = defs.find((d) => d.name === type) as Def
    if (def.kind === 'enum') return w.uint(Number(def.fields.find(([name]) => name === v)?.[1]))
    const obj = v as Record<string, unknown>
    def.fields.forEach(([name, fieldType, isArray], i) => {
      if (def.kind === 'message' && obj[name] === undefined) return
      if (def.kind === 'message') w.uint(i + 1)
      if (isArray) {
        const list = obj[name] as unknown[]
        w.uint(list.length)
        for (const item of list) write(fieldType, item)
      } else write(fieldType, obj[name])
    })
    if (def.kind === 'message') w.uint(0)
  }
  write(root, value)
  return Uint8Array.from(w.out)
}

/** The bare `canvas.fig`: header, version, deflated schema and message. */
export function canvas(defs: Def[], message: unknown, version = 101): Uint8Array {
  const chunks = [encodeSchema(defs), encodeMessage(defs, 'Message', message)].map((c) =>
    zlib.deflateRawSync(c),
  )
  const header = new Uint8Array(12)
  header.set(new TextEncoder().encode('fig-kiwi'))
  new DataView(header.buffer).setUint32(8, version, true)
  const parts: Uint8Array[] = [header]
  for (const c of chunks) {
    const length = new Uint8Array(4)
    new DataView(length.buffer).setUint32(0, c.length, true)
    parts.push(length, c)
  }
  return Buffer.concat(parts)
}

/** A ZIP with stored entries, as Figma wraps `canvas.fig`, `meta.json` and the thumbnail. */
export function zip(files: Record<string, Uint8Array>): Uint8Array {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, data] of Object.entries(files)) {
    const n = Buffer.from(name)
    const crc = zlib.crc32(data)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt32LE(crc, 14)
    head.writeUInt32LE(data.length, 18)
    head.writeUInt32LE(data.length, 22)
    head.writeUInt16LE(n.length, 26)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(data.length, 20)
    dir.writeUInt32LE(data.length, 24)
    dir.writeUInt16LE(n.length, 28)
    dir.writeUInt32LE(offset, 42)
    local.push(head, n, Buffer.from(data))
    central.push(dir, n)
    offset += 30 + n.length + data.length
  }
  const size = central.reduce((s, b) => s + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(size, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, ...central, end])
}

/** The part of Figma's schema that variables use, in the shape Figma's own schema has. */
export const FIG_SCHEMA: Def[] = [
  {
    name: 'GUID',
    kind: 'struct',
    fields: [
      ['sessionID', 'uint'],
      ['localID', 'uint'],
    ],
  },
  {
    name: 'NodeType',
    kind: 'enum',
    fields: [
      ['DOCUMENT', '1'],
      ['VARIABLE_SET', '2'],
      ['VARIABLE', '3'],
    ],
  },
  {
    name: 'Color',
    kind: 'struct',
    fields: [
      ['r', 'float'],
      ['g', 'float'],
      ['b', 'float'],
      ['a', 'float'],
    ],
  },
  { name: 'VariableID', kind: 'message', fields: [['guid', 'GUID']] },
  {
    name: 'VariableAnyValue',
    kind: 'message',
    fields: [
      ['colorValue', 'Color'],
      ['floatValue', 'float'],
      ['textValue', 'string'],
      ['alias', 'VariableID'],
    ],
  },
  { name: 'VariableData', kind: 'message', fields: [['value', 'VariableAnyValue']] },
  {
    name: 'VariableDataValuesEntry',
    kind: 'message',
    fields: [
      ['modeID', 'GUID'],
      ['variableData', 'VariableData'],
    ],
  },
  { name: 'VariableDataValues', kind: 'message', fields: [['entries', 'VariableDataValuesEntry', true]] },
  {
    name: 'VariableSetMode',
    kind: 'message',
    fields: [
      ['id', 'GUID'],
      ['name', 'string'],
      ['sortPosition', 'string'],
    ],
  },
  {
    name: 'CodeSyntaxEntry',
    kind: 'message',
    fields: [
      ['platform', 'string'],
      ['value', 'string'],
    ],
  },
  { name: 'CodeSyntax', kind: 'message', fields: [['entries', 'CodeSyntaxEntry', true]] },
  {
    name: 'NodeChange',
    kind: 'message',
    fields: [
      ['guid', 'GUID'],
      ['type', 'NodeType'],
      ['name', 'string'],
      ['variableSetModes', 'VariableSetMode', true],
      ['variableSetID', 'VariableID'],
      ['variableResolvedType', 'string'],
      ['variableDataValues', 'VariableDataValues'],
      ['variableScopes', 'string', true],
      ['codeSyntax', 'CodeSyntax'],
      ['isSoftDeleted', 'bool'],
      ['isPublishable', 'bool'],
    ],
  },
  { name: 'Message', kind: 'message', fields: [['nodeChanges', 'NodeChange', true]] },
]
