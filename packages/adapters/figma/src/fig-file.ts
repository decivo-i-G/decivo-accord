import zlib from 'node:zlib'

/**
 * Figma's own file format: a `.fig` file (as saved with "Save local copy") is a ZIP holding
 * `canvas.fig`, which starts with `fig-kiwi`, a version and two compressed chunks: the kiwi schema and
 * the document message encoded with it. The schema travels with the file, so decoding needs no
 * knowledge of Figma's internal types; Accord only reads variable nodes from the result.
 *
 * Everything here works on untrusted bytes: every read is bounds-checked and fails with a FigFileError.
 */
export class FigFileError extends Error {}

const MAX_OUTPUT = 512 * 1024 * 1024
const decoder = new TextDecoder()

/** The files of a ZIP archive (stored or deflated entries; enough for `.fig`). */
export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (at: number) => {
    if (at + 2 > bytes.length) throw new FigFileError('truncated ZIP')
    return view.getUint16(at, true)
  }
  const u32 = (at: number) => {
    if (at + 4 > bytes.length) throw new FigFileError('truncated ZIP')
    return view.getUint32(at, true)
  }
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--)
    if (u32(i) === 0x06054b50) {
      end = i
      break
    }
  if (end < 0) throw new FigFileError('not a ZIP archive')
  const files = new Map<string, Uint8Array>()
  let at = u32(end + 16)
  for (let n = u16(end + 10); n > 0; n--) {
    if (u32(at) !== 0x02014b50) throw new FigFileError('broken ZIP directory')
    const method = u16(at + 10)
    const size = u32(at + 20)
    const nameLength = u16(at + 28)
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength))
    const local = u32(at + 42)
    at += 46 + nameLength + u16(at + 30) + u16(at + 32)
    if (u32(local) !== 0x04034b50) throw new FigFileError('broken ZIP entry')
    const start = local + 30 + u16(local + 26) + u16(local + 28)
    if (start + size > bytes.length) throw new FigFileError('truncated ZIP')
    const data = bytes.subarray(start, start + size)
    if (method === 0) files.set(name, data)
    else if (method === 8) files.set(name, zlib.inflateRawSync(data, { maxOutputLength: MAX_OUTPUT }))
  }
  return files
}

function inflate(chunk: Uint8Array): Uint8Array {
  const zstd = chunk[0] === 0x28 && chunk[1] === 0xb5 && chunk[2] === 0x2f && chunk[3] === 0xfd
  if (!zstd) return zlib.inflateRawSync(chunk, { maxOutputLength: MAX_OUTPUT })
  const decompress = (zlib as { zstdDecompressSync?: typeof zlib.inflateRawSync }).zstdDecompressSync
  if (!decompress)
    throw new FigFileError('this .fig file is zstd-compressed; reading it needs Node.js 22.15 or newer')
  return decompress(chunk, { maxOutputLength: MAX_OUTPUT })
}

class Reader {
  i = 0
  constructor(readonly b: Uint8Array) {}
  byte(): number {
    if (this.i >= this.b.length) throw new FigFileError('truncated kiwi data')
    return this.b[this.i++] as number
  }
  uint(): number {
    let result = 0
    for (let shift = 0; shift < 35; shift += 7) {
      const x = this.byte()
      result |= (x & 127) << shift
      if (!(x & 128)) break
    }
    return result >>> 0
  }
  int(): number {
    const v = this.uint()
    return v & 1 ? ~(v >>> 1) : v >>> 1
  }
  uint64(): bigint {
    let result = 0n
    for (let shift = 0n; shift < 70n; shift += 7n) {
      const x = this.byte()
      result |= BigInt(x & 127) << shift
      if (!(x & 128)) break
    }
    return result
  }
  string(): string {
    const start = this.i
    while (this.byte() !== 0);
    return decoder.decode(this.b.subarray(start, this.i - 1))
  }
  float(): number {
    const first = this.byte()
    if (first === 0) return 0
    let bits = first | (this.byte() << 8) | (this.byte() << 16) | (this.byte() << 24)
    bits = (bits << 23) | (bits >>> 9)
    const view = new DataView(new ArrayBuffer(4))
    view.setInt32(0, bits)
    return view.getFloat32(0)
  }
  bytes(length: number): Uint8Array {
    if (this.i + length > this.b.length) throw new FigFileError('truncated kiwi data')
    const out = this.b.subarray(this.i, this.i + length)
    this.i += length
    return out
  }
}

interface Field {
  name: string
  type: number
  isArray: boolean
  value: number
}
interface Definition {
  name: string
  kind: number
  fields: Field[]
  byValue: Map<number, Field>
}

const ENUM = 0
const STRUCT = 1
const BUILTIN = ['bool', 'byte', 'int', 'uint', 'float', 'string', 'int64', 'uint64'] as const

function readSchema(bytes: Uint8Array): Definition[] {
  const r = new Reader(bytes)
  const definitions: Definition[] = []
  for (let n = r.uint(); n > 0; n--) {
    const name = r.string()
    const kind = r.byte()
    const fields: Field[] = []
    for (let f = r.uint(); f > 0; f--)
      fields.push({ name: r.string(), type: r.int(), isArray: r.byte() === 1, value: r.uint() })
    definitions.push({ name, kind, fields, byValue: new Map(fields.map((f) => [f.value, f])) })
  }
  return definitions
}

function decode(definitions: Definition[], root: string, bytes: Uint8Array): Record<string, unknown> {
  const r = new Reader(bytes)
  const read = (type: number, isArray: boolean, depth: number): unknown => {
    if (depth > 64) throw new FigFileError('kiwi data nested too deeply')
    if (isArray) {
      const length = r.uint()
      if (type === -2) return r.bytes(length)
      if (length > r.b.length - r.i) throw new FigFileError('truncated kiwi data')
      const out: unknown[] = []
      for (let k = 0; k < length; k++) out.push(read(type, false, depth + 1))
      return out
    }
    if (type < 0) {
      switch (BUILTIN[~type]) {
        case 'bool':
          return r.byte() !== 0
        case 'byte':
          return r.byte()
        case 'int':
          return r.int()
        case 'uint':
          return r.uint()
        case 'float':
          return r.float()
        case 'string':
          return r.string()
        case 'int64':
        case 'uint64':
          return r.uint64()
        default:
          throw new FigFileError(`unknown kiwi type ${type}`)
      }
    }
    const def = definitions[type]
    if (!def) throw new FigFileError(`unknown kiwi type ${type}`)
    if (def.kind === ENUM) {
      const v = r.uint()
      return def.byValue.get(v)?.name ?? v
    }
    const out: Record<string, unknown> = {}
    if (def.kind === STRUCT) {
      for (const f of def.fields) out[f.name] = read(f.type, f.isArray, depth + 1)
      return out
    }
    for (;;) {
      const v = r.uint()
      if (v === 0) return out
      const f = def.byValue.get(v)
      if (!f) throw new FigFileError(`unknown field ${v} in ${def.name}`)
      out[f.name] = read(f.type, f.isArray, depth + 1)
    }
  }
  const index = definitions.findIndex((d) => d.name === root)
  if (index < 0) throw new FigFileError(`no ${root} in the file's schema`)
  return read(index, false, 0) as Record<string, unknown>
}

/** The decoded document of a `.fig` file (ZIP or bare `fig-kiwi`): `{ nodeChanges: [...] , ... }`. */
export function readFigDocument(bytes: Uint8Array): Record<string, unknown> {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b
  const canvas = isZip ? unzip(bytes).get('canvas.fig') : bytes
  if (!canvas) throw new FigFileError('no canvas.fig in the archive')
  if (decoder.decode(canvas.subarray(0, 8)) !== 'fig-kiwi')
    throw new FigFileError('not a Figma file (fig-kiwi)')
  const view = new DataView(canvas.buffer, canvas.byteOffset, canvas.byteLength)
  const chunks: Uint8Array[] = []
  for (let at = 12; at + 4 <= canvas.length && chunks.length < 2; ) {
    const length = view.getUint32(at, true)
    at += 4
    if (at + length > canvas.length) throw new FigFileError('truncated Figma file')
    chunks.push(canvas.subarray(at, at + length))
    at += length
  }
  const [schema, data] = chunks
  if (!schema || !data) throw new FigFileError('truncated Figma file')
  return decode(readSchema(inflate(schema)), 'Message', inflate(data))
}
