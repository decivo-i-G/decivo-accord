import { describe, expect, it } from 'vitest'
import { scanScript, scanStylesheet } from './hard-values.js'

const found = (code: string) =>
  scanScript(code, 'x.tsx').map((v) => `${v.line}:${v.column} ${v.context} ${v.raw}`)

describe('scanScript', () => {
  it('finds whole-string colours, Tailwind arbitrary values and embedded colours', () => {
    expect(
      found(`const a = '#487a98'
const b = <div className="bg-[#487A98] p-[13px] m-[0px] shadow-[0_0_4px_rgba(0,0,0,0.1)]" />
const c = \`border: 1px solid #16222b;\``),
    ).toEqual([
      '1:12 string #487a98',
      '2:31 tailwind #487A98',
      '2:43 tailwind 13px',
      '2:73 embedded rgba(0,0,0,0.1)',
      '3:30 embedded #16222b',
    ])
  })

  it('reads React style objects, including numbers as px for design properties', () => {
    expect(
      found(`<p style={{ color: 'white', padding: 12, width: 320, gap: '1rem', margin: 0 }} />`),
    ).toEqual(['1:21 style white', '1:38 style 12', '1:60 style 1rem'])
  })

  it('ignores imports, anchors, short hex in prose, and lines marked accord-ignore', () => {
    expect(
      found(`import x from './a#ffffff.svg'
type Tone = '#000000'
const link = <a href="#add">x</a>
const prose = 'Fehler #123 und #abc'
// accord-ignore
const legacy = '#ff0000'`),
    ).toEqual([])
  })

  it('skips the whole file with accord-ignore-file', () => {
    expect(found(`// accord-ignore-file\nconst a = '#487a98'`)).toEqual([])
  })

  it('survives syntax errors', () => {
    expect(found(`const a = '#487a98'; const = ;`)).toEqual(['1:12 embedded #487a98'])
  })
})

describe('scanStylesheet', () => {
  it('finds literal colours outside custom properties', () => {
    const values = scanStylesheet(
      `:root { --brand: #487a98; }
.a { color: #16222b; box-shadow: 0 1px 2px rgba(0, 0, 0, .1); background: var(--brand); }
/* accord-ignore */
.b { color: red; }`,
      'a.css',
    )
    expect(values.map((v) => `${v.line}:${v.column} ${v.raw}`)).toEqual([
      '2:13 #16222b',
      '2:44 rgba(0, 0, 0, .1)',
    ])
  })
})

describe('Tailwind arbitrary lengths', () => {
  it('flags spacing, radius and type sizes, not layout sizes', () => {
    expect(
      found(
        `<div className="max-w-[32rem] w-[680px] px-[13px] hover:rounded-[6px] text-[15px] top-[3px]" />`,
      ),
    ).toEqual(['1:45 tailwind 13px', '1:66 tailwind 6px', '1:77 tailwind 15px'])
  })
})

describe('categories and inline-only files', () => {
  it('tags lengths with what they are for', () => {
    const values = scanScript(`<p className="text-[10px] rounded-[10px]" style={{ padding: 10 }} />`, 'x.tsx')
    expect(values.map((v) => v.category)).toEqual(['fontSize', 'radius', 'spacing'])
  })

  it('marks files rendering without CSS variables', () => {
    const og = scanScript(`import { ImageResponse } from 'next/og'\nconst c = '#487a98'`, 'og.tsx')
    expect(og[0]?.inlineOnly).toBe(true)
    const pdf = scanScript(`import { View } from '@react-pdf/renderer'\nconst c = '#487a98'`, 'x.tsx')
    expect(pdf[0]?.inlineOnly).toBe(true)
    expect(scanScript(`const c = '#487a98'`, 'x.tsx')[0]?.inlineOnly).toBeUndefined()
  })
})
