/**
 * **decivo v6 style, no AI slop** (docs/web-redesign.md, 20.10.2026).
 *
 * Accord was brought into the style of decivo.de v6 and the AI-slop patterns were removed. This test
 * keeps them from coming back, like decivo's own `rescue/__tests__/v6-style.test.tsx`:
 *
 * 1. no eyebrows or kickers (uppercase, letter-spaced labels, an "eyebrow" class),
 * 2. no em or en dashes in any message string (de, en) or in text written into the code,
 * 3. no coloured border-left/right accents and no inset accent bars; selection is a tint,
 * 4. no card shadows: a shadow only on things that float,
 * 5. no gradients (except the transparency checker behind swatches), glow, blur, pulse or hover lift,
 * 6. no progress rings, gauges or sparklines,
 * 7. the type and the shapes: Merriweather 300 for headings, IBM Plex Sans and Mono, no Inter,
 *    radii of 4/6/8px,
 * 8. the dot row (`DotTag`) sits directly above every page title,
 * 9. no unicode glyphs as icons (the → arrow is the ArrowRight icon),
 * 10. the sun/moon switch is one tap away on phones too, never Hell/Dunkel text in the shell,
 * 11. where you are stays visible in forced colours,
 * 12. every control is drawn as a 44px target, with no small button size.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NextIntlClientProvider } from 'next-intl'
import { type ComponentType, createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import de from '../../messages/de.json'
import en from '../../messages/en.json'
import { CommandLine } from '../components/command-line'
import { CopyButton, CopyValue } from '../components/copy-button'
import { PageHeader } from '../components/page-header'
import { DisclosureSummary } from '../components/proposal-parts'
import { ThemeSwitch } from '../components/shell-client'
import { ToastProvider } from '../components/toast'

const src = fileURLToPath(new URL('..', import.meta.url))

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path, ext)
    return ext.test(name) && !name.includes('.test.') ? [path] : []
  })
}

const css = files(src, /\.css$/)
  .filter((f) => !f.endsWith('tokens.css'))
  .map((f) => ({ file: relative(src, f), text: readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }))
const code = files(src, /\.tsx?$/).map((f) => ({ file: relative(src, f), text: readFileSync(f, 'utf8') }))
const tokens = readFileSync(join(src, 'app/tokens.css'), 'utf8')

/** Innermost CSS rules as selector + body (enough for these flat CSS modules and @media blocks). */
function rules(text: string) {
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: (m[1] as string).trim(),
    body: m[2] as string,
  }))
}

/** Every string in a message tree with its key. */
function strings(tree: unknown, path = ''): [string, string][] {
  if (typeof tree === 'string') return [[path, tree]]
  if (tree && typeof tree === 'object')
    return Object.entries(tree).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k))
  return []
}

/** Source without comments, so that only text and code remain. */
function withoutComments(text: string) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

const DASH = /[–—]/
const NEUTRAL_LINE = /var\(--color-border-(subtle|default|strong|control)\)/

describe('decivo v6: no eyebrows', () => {
  it.each(css)('$file has no uppercase or letter-spaced labels', ({ text }) => {
    expect(text).not.toMatch(/text-transform:\s*uppercase/)
    expect(text).not.toMatch(/font-variant(-caps)?:\s*(all-)?small-caps/)
    expect(text).not.toMatch(/letter-spacing:\s*(?!0[;\s]|normal|-)/)
  })

  it.each([...css, ...code])('$file has no eyebrow or kicker class', ({ text }) => {
    expect(text).not.toMatch(/\.(eyebrow|kicker)\b|styles\.(eyebrow|kicker)\b/i)
  })
})

describe('decivo v6: no dashes in visible text', () => {
  it.each([
    ['de', de],
    ['en', en],
  ] as const)('messages/%s.json has no em or en dash', (_locale, messages) => {
    const found = strings(messages).filter(([, text]) => DASH.test(text))
    expect(found).toEqual([])
  })

  it.each(code)('$file writes no dash into the interface', ({ text }) => {
    const lines = withoutComments(text)
      .split('\n')
      .filter((line) => DASH.test(line))
    expect(lines).toEqual([])
  })
})

describe('decivo v6: selection is a tint, elevation a hairline', () => {
  it.each(css)('$file has no coloured side accents', ({ file, text }) => {
    for (const { selector, body } of rules(text)) {
      for (const m of body.matchAll(/border-(left|right|inline-start|inline-end)(-color)?:\s*([^;]+);/g)) {
        const value = m[3] as string
        expect(NEUTRAL_LINE.test(value) || /^0$|^none$/.test(value), `${file} ${selector}: ${m[0]}`).toBe(
          true,
        )
      }
      // An inset shadow offset to one side is the same accent bar in disguise.
      expect(body, `${file} ${selector}`).not.toMatch(/box-shadow:\s*inset\s+(?!0\s)\S+\s+0\s+0/)
    }
  })

  it.each(css)('$file has shadows only on things that float', ({ file, text }) => {
    for (const { selector, body } of rules(text)) {
      for (const m of body.matchAll(/box-shadow:\s*([^;]+);/g)) {
        const value = m[1] as string
        const hairline =
          /^inset 0 0 0 var\(--stroke-default\) var\(--color-(?:border-[a-z]+|swatch-frame)\)$/.test(value)
        const preview = value === 'var(--pv-shadow)' // the register shows a shadow token's own value
        const underline = /^inset 0 calc\(var\(--stroke-strong\) \* -1\) 0 var\(--color-focus\)$/.test(value)
        const floating =
          value === 'var(--shadow-lg)' && /popover|dialog|toast|drawer|skip|menu|palette|tip/i.test(selector)
        expect(hairline || preview || underline || floating, `${file} ${selector}: ${value}`).toBe(true)
      }
    }
  })

  it('has no shadow tokens for cards any more', () => {
    expect(tokens).not.toMatch(/--shadow-(sm|md):/)
  })
})

describe('decivo v6: no gradients, glow, pulse or hover lift', () => {
  it.each(css)('$file', ({ file, text }) => {
    for (const { selector, body } of rules(text)) {
      const where = `${file} ${selector}`
      // The checkerboard behind translucent swatches is the one allowed gradient.
      if (!body.includes('--checker')) expect(body, where).not.toMatch(/gradient\(/)
      expect(body, where).not.toMatch(/text-shadow|backdrop-filter|filter:\s*(blur|drop-shadow)/)
      if (/:hover/.test(selector)) expect(body, where).not.toMatch(/translate|scale\(/)
    }
    // Motion: only the loading dots fill, nothing that pulses for attention.
    for (const m of text.matchAll(/@keyframes\s+([\w-]+)/g)) expect(m[1]).toBe('fill')
  })

  it('has one authored motion moment, the dot fill, on an exponential ease-out', () => {
    const animated = css.filter(({ text }) => /animation:\s*(?!none\b)[^\s;]/.test(text)).map((c) => c.file)
    expect(animated).toEqual([join('components', 'brand-dots.module.css')])
    expect(tokens).toMatch(/--easing-enter:\s*cubic-bezier\(0\.16, 1, 0\.3, 1\);/)
  })

  it.each(code)('$file has no gradient or glow in inline styles', ({ text }) => {
    expect(text).not.toMatch(/(linear|radial|conic)-gradient|textShadow|backdropFilter/)
  })
})

describe('decivo v6: no rings, gauges or sparklines', () => {
  // icons.tsx draws the tool marks (Figma, Pencil); their circles are glyph parts, not charts.
  it.each(code.filter((c) => !c.file.endsWith('icons.tsx')))('$file', ({ text }) => {
    expect(text).not.toMatch(/strokeDasharray|stroke-dasharray|<circle|<polyline|Sparkline|Gauge|ScoreRing/)
  })
})

describe('decivo v6: type and shape', () => {
  const value = (name: string) => tokens.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1] ?? ''

  it('uses Merriweather, IBM Plex Sans and IBM Plex Mono, never Inter', () => {
    expect(value('font-heading')).toMatch(/^Merriweather,/)
    expect(value('font-ui')).toMatch(/^"IBM Plex Sans",/)
    expect(value('font-mono')).toMatch(/^"IBM Plex Mono",/)
    expect(tokens + css.map((c) => c.text).join('')).not.toMatch(/\bInter\b/)
    const layout = readFileSync(join(src, 'app/layout.tsx'), 'utf8')
    expect(layout).toMatch(/@fontsource\/merriweather\/latin-300\.css/)
    expect(layout).not.toMatch(/@fontsource\/inter/)
  })

  it.each(css)('$file sets every heading-face text in weight 300', ({ file, text }) => {
    for (const { selector, body } of rules(text))
      if (/font-family:\s*var\(--font-heading\)/.test(body))
        expect(body, `${file} ${selector}`).toMatch(/font-weight:\s*var\(--font-weight-light\)/)
  })

  // Only these weights are loaded (layout.tsx); any other is synthesised by the browser and smears.
  const LOADED = {
    mono: /^var\(--font-weight-(regular|medium)\)$/,
    heading: /^var\(--font-weight-light\)$/,
    ui: /^(var\(--font-weight-(regular|medium|semibold)\)|inherit)$/,
  }

  it.each(css)(
    '$file sets each face only in a loaded weight (mono 400/500, heading 300, sans 400 to 600)',
    ({ file, text }) => {
      for (const { selector, body } of rules(text)) {
        const face = /font-family:\s*var\(--font-(mono|heading|ui)\)/.exec(body)?.[1] as
          | keyof typeof LOADED
          | undefined
        const weight = /font-weight:\s*([^;]+);/.exec(body)?.[1]?.trim()
        // Previews of the customer's own type (`--pv-weight`, `--preview-weight`) draw their data, not ours.
        if (!weight || /^var\(--(pv|preview)-/.test(weight)) continue
        expect(weight, `${file} ${selector}`).toMatch(LOADED[face ?? 'ui'])
        expect(weight, `${file} ${selector}`).not.toMatch(/^(\d+|bold|bolder)$/)
      }
    },
  )

  it('draws the register tree in loaded mono weights: group names and the selected token at 500', () => {
    const register = rules(css.find((c) => c.file.endsWith('register.module.css'))?.text ?? '')
    const body = (selector: string) => register.find((r) => r.selector === selector)?.body ?? ''
    expect(body('.groupName')).toMatch(/font-weight:\s*var\(--font-weight-medium\)/)
    expect(body('.tokenTable .row[data-current] .rowLink')).toMatch(
      /font-weight:\s*var\(--font-weight-medium\)/,
    )
    // A translated family label ("Semantisch") is an interface word, not a token name.
    expect(body('.familyLabel')).not.toMatch(/--font-mono/)
  })

  it('keeps radii small: 4, 6 and 8px, pills only for chips', () => {
    expect(value('radius-sm')).toBe('4px')
    expect(value('radius-md')).toBe('6px')
    expect(value('radius-lg')).toBe('8px')
    expect(tokens).not.toMatch(/--radius-xl/)
  })

  it('has a white page in the light scheme', () => {
    expect(value('color-surface-page')).toBe('var(--color-neutral-0)')
    expect(value('color-neutral-0')).toBe('#ffffff')
  })
})

describe('decivo v6: the dot row sits above the page title', () => {
  it('PageHeader renders DotTag (four dots and the label) directly before the H1', () => {
    const html = renderToStaticMarkup(createElement(PageHeader, { tag: 'Projekte', title: 'Projekte' }))
    const tag = html.match(
      /<p[^>]*>(<span aria-hidden="true"[^>]*>(?:<span[^>]*><\/span>){4}<\/span>)<span>([^<]*)<\/span><\/p><h1/,
    )
    expect(tag, html).not.toBeNull()
    expect(tag?.[2]).toBe('Projekte')
  })

  it('on project pages the four dots stand alone above the H1: the project is named once, in the switcher', () => {
    const html = renderToStaticMarkup(createElement(PageHeader, { title: 'Entscheidungen' }))
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>(?:<span[^>]*><\/span>){4}<\/span><h1/)
    const pages = ['page.tsx', 'decisions/page.tsx', 'register/page.tsx', 'connections/page.tsx']
    for (const page of pages) {
      const text = readFileSync(join(src, 'app/p/[project]', page), 'utf8')
      expect(text, page).toMatch(/<PageHeader\b/)
      expect(text, page).not.toMatch(/<PageHeader[^>]*\btag=/)
    }
  })

  it('gives every page title one size, compact or not', () => {
    const header = css.find((c) => c.file.endsWith('page-header.module.css'))?.text ?? ''
    const sizes = rules(header)
      .filter(({ selector }) => /\.title\b/.test(selector))
      .flatMap(({ body }) => [...body.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]))
    expect(sizes).toEqual(['var(--font-size-3xl)'])
  })
})

describe('decivo v6: one icon set, no glyphs as icons', () => {
  it.each([
    ['de', de],
    ['en', en],
  ] as const)('messages/%s.json has no arrow glyph', (_locale, messages) => {
    expect(strings(messages).filter(([, text]) => /[→←↑↓⇒➜]/.test(text))).toEqual([])
  })

  // The agents box shows a terminal transcript: there the arrow is part of the quoted output.
  it.each(code.filter((c) => !c.file.endsWith('register-inspectors.tsx')))(
    '$file writes no arrow glyph into the interface',
    ({ text }) => {
      const lines = withoutComments(text)
        .split('\n')
        // Key caps (<Kbd>↑</Kbd>) print the key's own symbol; that is a key name, not an icon.
        .filter((line) => /[→←↑↓⇒➜]/.test(line) && !/<Kbd>[←↑↓→]<\/Kbd>/.test(line))
      expect(lines).toEqual([])
    },
  )
})

describe('decivo v6: the appearance switch is the sun/moon icon, everywhere', () => {
  const shell = readFileSync(join(src, 'components/shell.tsx'), 'utf8')

  it('sits in the phone top bar, next to search, as well as in the sidebar footer', () => {
    expect(shell).toMatch(
      /<header className=\{styles\.topbar\}>[\s\S]*<ThemeSwitch theme=\{theme\} place="topbar" \/>[\s\S]*<CommandPalette[\s\S]*<\/header>/,
    )
    expect(shell).toMatch(/<SidebarFooter locale=\{locale\} theme=\{theme\} \/>/)
  })

  it('is an icon button named by what it does, with no Hell/Dunkel text beside it', () => {
    const html = render(createElement(ThemeSwitch, { theme: 'light', place: 'topbar' }))
    expect(html).toContain('aria-label="Dunkelmodus einschalten"')
    expect(html).toContain('aria-label="Hellen Modus einschalten"')
    // Only the long-press menu (hidden until opened) names the schemes, to offer System.
    const visible = html.replace(/<div id="[^"]*" class="[^"]*" hidden="">[\s\S]*$/, '')
    expect(visible).not.toMatch(/>(Hell|Dunkel|System)</)
  })

  it('has no Hell/Dunkel segments in the shell', () => {
    expect(shell).not.toMatch(/ThemeChoices/)
    expect(Object.keys(de.shell)).not.toContain('themeShort')
  })
})

describe('accessibility: where you are survives forced colours', () => {
  it.each(['components/shell.module.css', 'components/tabs.module.css', 'components/proposals.module.css'])(
    '%s outlines the current item in the system highlight',
    (file) => {
      const text = css.find((c) => c.file === join(...file.split('/')))?.text ?? ''
      const block = text.slice(text.indexOf('@media (forced-colors: active)'))
      expect(block).toMatch(/aria-current/)
      expect(block).toMatch(/outline:\s*var\(--stroke-strong\) solid Highlight/)
    },
  )
})

describe('accessibility: every control is a 44px target', () => {
  /** The last class of each selector in a list (`.themeMenu .popoverItem` → popoverItem). */
  const lastClasses = (selector: string) =>
    selector.split(',').flatMap((part) => /\.([\w-]+)[^.\s]*$/.exec(part.trim())?.[1] ?? [])
  const TARGET = /(min-)?(height|block-size):\s*(var\(--size-target\)|calc\(var\(--size-target\) \+)/

  it('has no small button size: no button is drawn at 32px with only an invisible hit area', () => {
    const buttons = css.find((c) => c.file.endsWith('button.module.css'))?.text ?? ''
    expect(buttons).not.toMatch(/--size-control-sm/)
    expect(rules(buttons).find(({ selector }) => selector === '.button')?.body).toMatch(
      /min-height:\s*var\(--size-target\)/,
    )
    expect(rules(buttons).find(({ selector }) => selector === '.icon')?.body).toMatch(
      /width:\s*var\(--size-target\)/,
    )
    const button = code.find((c) => c.file.endsWith(join('components', 'button.tsx')))?.text ?? ''
    expect(button).not.toMatch(/'sm'/)
  })

  it('gives every clickable rule (cursor: pointer) a height of at least the 44px target', () => {
    for (const { file, text } of css) {
      const all = rules(text)
      for (const { selector, body } of all) {
        if (!/cursor:\s*pointer/.test(body)) continue
        // The height may sit in the element's base rule (`.popoverItem`), sized once for every context.
        const classes = lastClasses(selector)
        const sized =
          TARGET.test(body) ||
          all.some(
            (r) =>
              !/:/.test(r.selector) &&
              TARGET.test(r.body) &&
              lastClasses(r.selector).some((c) => classes.includes(c)),
          )
        expect(sized, `${file} ${selector}`).toBe(true)
        expect(body, `${file} ${selector}`).not.toMatch(/--size-control-sm/)
      }
    }
  })
})

describe('accessibility: the colours being decided survive forced colours', () => {
  it('paints every swatch class with forced-color-adjust: none', () => {
    const swatch = css.find((c) => c.file.endsWith('swatch.module.css'))?.text ?? ''
    const base = rules(swatch).find(({ selector }) => selector === '.swatch')
    expect(base?.body).toMatch(/forced-color-adjust:\s*none/)
    // Every other swatch-like class in the app (a class named after a swatch) does the same.
    for (const { file, text } of css)
      for (const { selector, body } of rules(text))
        if (
          /\.[a-zA-Z]*[sS]watch\b(?![-\w])/.test(selector) &&
          /background(-color)?:\s*var\(--swatch/.test(body)
        )
          expect(body, `${file} ${selector}`).toMatch(/forced-color-adjust:\s*none/)
  })
})

describe('decivo v6: disclosures look like controls', () => {
  it('every inspector disclosure renders the turning chevron (DisclosureSummary), never a bare summary', () => {
    const html = renderToStaticMarkup(createElement(DisclosureSummary, null, 'Details'))
    expect(html).toMatch(/^<summary[^>]*><svg[^>]*aria-hidden="true"[\s\S]*<\/svg>Details<\/summary>$/)
    for (const { file, text } of code)
      expect(text, file).not.toMatch(/<summary className=\{styles\.disclosure\}/)
    const proposalsCss = css.find((c) => c.file.endsWith('proposals.module.css'))?.text ?? ''
    expect(proposalsCss).toMatch(
      /details\[open\] > \.disclosure \.disclosureChevron \{\s*transform: rotate\(90deg\)/,
    )
  })

  it('sets bold in a loaded weight (600), never a synthesised 700', () => {
    const globals = css.find((c) => c.file.endsWith('globals.css'))?.text ?? ''
    const bold = rules(globals).find(({ selector }) => /^strong,\s*b$/.test(selector))
    expect(bold?.body).toMatch(/font-weight:\s*var\(--font-weight-semibold\)/)
  })
})

describe('simplicity: one word, one meaning', () => {
  // "Entscheidungen" is the inbox. The register's rules are "Regeln"; only links into the inbox, and
  // sentences about what waits there, may say "Entscheidung" in the register.
  const INBOX = [
    'tokens.open',
    'token.openTitle',
    'token.openLink',
    'token.ownerSentence.design',
    'token.ownerSentence.code',
    'token.ownerSentence.register',
    'tokenOverview.open',
    'agents.proposals',
  ]

  it.each([
    ['de', de],
    ['en', en],
  ] as const)(
    'messages/%s.json calls rules "Regeln" in the register, never decisions',
    (_locale, messages) => {
      const found = strings(messages.register)
        .filter(([key]) => !INBOX.includes(key))
        // The folder name `.accord/decisions` is a path, not a word on the screen.
        .filter(([, text]) => /ntscheidung|decision/i.test(text.replaceAll('.accord/decisions', '')))
      expect(found).toEqual([])
    },
  )

  it('calls a Claude Design handoff a draft in the inbox, and asks with the verb of the button', () => {
    expect(strings(de.proposals).filter(([, text]) => /Handoff/.test(text))).toEqual([])
    expect(strings(en.proposals).filter(([, text]) => /handoff/i.test(text))).toEqual([])
    // The deletion question ends with the button's verb, never with "übernehmen" / "adopt".
    expect(de.proposals.actions.confirmDeletionText).toMatch(/Wirklich löschen\?$/)
    expect(en.proposals.actions.confirmDeletionText).toMatch(/Delete anyway\?$/)
    expect(en.proposals.actions.recommended).toBe('Recommended:')
  })

  it('says "fest eingetragen", never "harte Werte" (de)', () => {
    expect(strings(de).filter(([, text]) => /\bhart(e|en|er)?\b/i.test(text))).toEqual([])
  })

  it('has no "X im Überblick" inspector titles that sound like the overview section', () => {
    expect(strings(de.register).filter(([, text]) => /im Überblick/.test(text))).toEqual([])
    expect(strings(en.register).filter(([, text]) => /at a glance/i.test(text))).toEqual([])
  })
})

describe('simplicity: a value copies itself in the row', () => {
  it('CopyValue is a real button named by its action and value, with the value as code', () => {
    const html = renderToStaticMarkup(
      createElement(
        // React adds the child as `children`; the provider's props type wants it spelled out.
        NextIntlClientProvider as ComponentType<{
          locale: string
          messages: typeof de
          children?: ReactNode
        }>,
        { locale: 'de', messages: de },
        createElement(CopyValue, { value: '--color-brand-700', label: de.register.tokens.copyVariable }),
      ),
    )
    expect(html).toMatch(/^<button type="button"/)
    expect(html).toContain('aria-label="CSS-Variable kopieren: --color-brand-700"')
    expect(html).toContain('<code>--color-brand-700</code>')
    expect(html).toContain('role="status"')
  })
})

/** Static markup of `node` inside the German messages, as the app renders it. */
function render(node: ReactNode) {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider as ComponentType<{ locale: string; messages: typeof de; children?: ReactNode }>,
      { locale: 'de', messages: de },
      node,
    ),
  )
}

describe('simplicity: copy buttons say what they copy, and speak through one live region', () => {
  it('names a command copy button by its command, with the short label as tooltip', () => {
    const html = render(
      createElement(CommandLine, { command: 'accord diff', label: de.connections.commands.copy }),
    )
    expect(html).toContain('aria-label="Befehl kopieren: accord diff"')
    expect(html).toMatch(/aria-hidden="true">Befehl kopieren<\/span>/)
  })

  it('has one shared role=status inside the app, not one per copy button', () => {
    const html = render(
      createElement(
        ToastProvider,
        null,
        createElement(CopyButton, { value: 'accord diff' }),
        createElement(CopyButton, { value: 'accord export' }),
        createElement(CopyValue, { value: '--brand', label: 'CSS-Variable kopieren' }),
      ),
    )
    expect(html.match(/role="status"/g)).toHaveLength(1)
  })
})

describe('simplicity: Connections uses the words of the rest of the app', () => {
  it('calls what reaches the inbox a decision, never a proposal', () => {
    expect(strings(de.connections).filter(([, text]) => /Vorschlag/.test(text))).toEqual([])
    expect(strings(en.connections).filter(([, text]) => /\bproposal/i.test(text))).toEqual([])
  })

  it('has no "Projekt-Abgleich" jargon and no "Immer an" beside handoffs that arrive anyway', () => {
    expect(strings(de.connections).filter(([, text]) => /Projekt-Abgleich|Immer an/.test(text))).toEqual([])
    expect(strings(en.connections).filter(([, text]) => /Project sync|Always on/.test(text))).toEqual([])
  })
})

describe('simplicity: Connections is a settings page: connected or not, one step, no primary', () => {
  const page = readFileSync(join(src, 'app/p/[project]/connections/page.tsx'), 'utf8')
  const focus = readFileSync(join(src, 'components/focus-target.tsx'), 'utf8')
  const rowsCss = readFileSync(join(src, 'components/connections.module.css'), 'utf8')
  const sw = readFileSync(join(src, 'components/surface-switch.tsx'), 'utf8')

  it('shows the code step as a secondary button: the overview carries it as its one primary', () => {
    expect(page).toMatch(/<IncludeCodeButton[^>]*variant="secondary"/)
    expect(page).not.toMatch(/variant="primary"/)
  })

  it('says before the code click what it writes, names no folder on the button, and offers an undo', () => {
    expect(page).toMatch(/label=\{t\('includeAll'\)\}\s*note=\{t\('includeNote'\)\}/)
    for (const m of [de, en]) {
      expect(m.connections.includeAll).not.toMatch(/[{/]/)
      expect(m.connections.includeNote).toBeTruthy()
      expect(m.overview.step.undo).toBeTruthy()
    }
    // The pending label says it is still running, not that it is done.
    expect(de.overview.step.including).toBe('Ordner werden aufgenommen')
    expect(en.overview.step.including).toBe('Adding folders')
    const button = readFileSync(join(src, 'components/include-code-button.tsx'), 'utf8')
    expect(button).toMatch(/label: t\('undo'\)/)
    expect(button).toMatch(/excludeCode\(/)
  })

  it('never repeats the inbox: no decide buttons or waiting counts, one link where a surface differs', () => {
    expect(page).not.toMatch(/t\('decide'\)|t\(next\.kind\)|state\.waiting|state\.files/)
    // The only way into the inbox is the sentence that says where a surface differs from the register.
    // It opens the inbox filtered to that surface (`?source=figma`), not one decision.
    expect(page).not.toMatch(/decisionHref\(/)
    expect(page.match(/agreementHref\(/g)).toHaveLength(1)
    expect(page).toMatch(/const href = agreementHref\(slug, tool, agreement\)/)
    for (const m of [de, en]) {
      const c = m.connections as unknown as Record<string, unknown>
      expect(c.decide).toBeUndefined()
      expect(c.review).toBeUndefined()
    }
  })

  it('leads with the state at a glance, not a sentence that is the same on every project', () => {
    expect(page).toMatch(/<PageHeader title=\{t\('title'\)\} lead=\{lead\} \/>/)
    expect(page).toMatch(/connectionSummary\(/)
    expect((de.connections as Record<string, unknown>).lead).toBeUndefined()
  })

  it('renders a switch only where it can change something, inside the row with a visible label', () => {
    expect(page).toMatch(
      /const canSwitch = \(tool === 'figma' \|\| tool === 'pen'\) && \(f\.found > 0 \|\| f\.enabled\)/,
    )
    expect(page).toMatch(/\{canSwitch && \(\s*<div className=\{styles\.switchRow\}>\s*<SurfaceSwitch/)
    // No right-hand column that means "always", "switch" or nothing from row to row.
    expect(page).not.toMatch(/styles\.(control|always)\b|switch\.always/)
    expect(rowsCss).not.toMatch(/\.control\b|\.always\b/)
    expect(page).not.toMatch(/FixedSwitch/)
    const swCss = readFileSync(join(src, 'components/surface-switch.module.css'), 'utf8')
    // No inert switch anywhere: no disabled prop, no washed-out opacity.
    expect(sw).not.toMatch(/\bdisabled\b/)
    expect(swCss).not.toMatch(/opacity|:disabled/)
  })

  it('labels the switch with what it does, visibly, and names the surface for screen readers', () => {
    expect(sw).toMatch(/<span className=\{styles\.label\}>\{t\('label'\)\}<\/span>/)
    expect(sw).toMatch(/\{` \(\$\{name\}\)`\}/)
    for (const m of [de, en]) {
      const s = m.connections.switch as Record<string, unknown>
      // The track shows the state: no On/Off text beside it.
      expect(s.stateOn).toBeUndefined()
      expect(s.stateOff).toBeUndefined()
      expect(s.always).toBeUndefined()
      expect(s.label).toBeTruthy()
    }
    // The always-compared surfaces say so once, in the line under their state.
    for (const m of [de, en]) {
      const c = m.connections as unknown as { compare: { when: Record<string, string> } }
      expect(c.compare.when.live).toBeTruthy()
      expect(c.compare.when.handoff).toContain('{when}')
    }
  })

  it('gives each surface one way in: one sentence and one path to copy, the variables export under "For developers"', () => {
    expect(page).toMatch(/figma: 'figma\/design-system\.fig'/)
    expect(page).toMatch(/pen: 'design\/app\.pen'/)
    expect(page).toMatch(/value: path,\s*label: t\('copyPath'\)/)
    // Claude Design has no file to place: its one thing to copy is the command that imports a handoff.
    expect(page).toMatch(
      /value: `accord ingest <\$\{t\('commands\.bundle'\)\}> --write`,\s*label: t\('claudeDesign\.copy'\)/,
    )
    expect(page).toMatch(/<CopyValue\s+value=\{add\.value\}\s+label=\{add\.label\}/)
    expect(page).toMatch(/t\.rich\('add\.figma', \{ code \}\)/)
    for (const m of [de, en]) {
      const c = m.connections as unknown as Record<string, Record<string, string>>
      // No telegraphic "Kein Login." and no second route in the row's text.
      expect(Object.values(c.how ?? {}).join(' ')).not.toMatch(/Kein Login\.|No sign-in\./)
      expect(c.step?.figmaFig).not.toMatch(/Plugin|plugin|variables2json|Oder|Or /)
      expect(c.claudeDesign?.step).not.toMatch(/Für Entwickler|For developers/)
      expect(c.claudeDesign?.later).toBeTruthy()
    }
  })

  it('marks the row a jump lands on even after a client-side navigation, where :target stays unset', () => {
    expect(focus).toMatch(/setAttribute\('data-target', ''\)/)
    expect(focus).toMatch(/scrollIntoView/)
    expect(rowsCss).toMatch(/\.row\[data-target\]::before/)
  })

  it('starts every state line with one of four icons: a check only when in sync, a dot, a dashed circle, a warning', () => {
    const icons = [...page.matchAll(/icon: <(\w+) aria-hidden="true" data-state="(\w+)" \/>/g)].map((m) => [
      m[2],
      m[1],
    ])
    expect(Object.fromEntries(icons)).toEqual({
      problem: 'TriangleAlert',
      differs: 'CircleDot',
      inSync: 'CircleCheck',
      off: 'CircleDashed',
    })
    expect(new Set(icons.map(([, icon]) => icon)).size).toBe(4)
    // The check means "matches the register", as on the overview: a connected surface that differs gets the dot.
    expect(page).toMatch(/connected && agreement\?\.kind === 'drift'\s*\? \{ className: styles\.differs/)
    expect(page).not.toMatch(/icon: null/)
    // Only the icon is coloured; the words stay in ink.
    expect(rowsCss).toMatch(/\.inSync svg \{\s*color: var\(--color-success-ink\);/)
    expect(rowsCss).toMatch(/\.inSync,\s*\.problem,\s*\.differs \{\s*color: var\(--color-ink\);/)
  })

  it('sets the text of a row in two sizes: the state at md, everything under it at sm (mono apart)', () => {
    const css = rules(withoutComments(rowsCss))
    const size = (selector: string) =>
      css.find((r) => r.selector === selector)?.body.match(/font-size:\s*var\(--font-size-([\w-]+)\)/)?.[1]
    // Every text class inside a row's body: state, sentence, step, hint, and the path or command to copy.
    const text = ['.state', '.sub', '.step', '.later']
    expect(text.map(size)).toEqual(['md', 'sm', 'sm', 'sm'])
    expect(size('.copyPathText')).toBe('sm')
    // No other font size is set on anything a row's body draws.
    const body = ['.body', '.subLink', '.addFile', '.copyPath', '.stepAction', '.switchRow']
    expect(body.map(size).filter(Boolean)).toEqual([])
    expect(new Set([...text, '.copyPathText'].map(size)).size).toBe(2)
    // No two muted lines sit on top of each other: what Accord read joins the sentence under the state.
    expect(page).not.toMatch(/styles\.fileLine|<FileLine/)
    expect(rowsCss).not.toMatch(/\.fileLine\b/)
  })
})

describe('simplicity: the project list shows state and one link per project, configuration closed', () => {
  const page = readFileSync(join(src, 'app/page.tsx'), 'utf8')
  const shell = readFileSync(join(src, 'components/shell.tsx'), 'utf8')

  it('has no kicker above the H1 and no one-word path repeating it', () => {
    expect(page).not.toMatch(/<PageHeader[^>]*\btag=/)
    expect(de.home).not.toHaveProperty('tag')
    expect(shell).not.toMatch(/\[\{ label: t\('shell\.projects'\) \}\]/)
  })

  it('never writes config from a row: every row action is a link, the add-project text sits in a closed disclosure', () => {
    expect(page).not.toMatch(/IncludeCodeButton/)
    expect(page).toMatch(/<details className=\{styles\.dev\}>\s*<DisclosureSummary>\{t\('dev'\)\}/)
    expect(page).not.toMatch(/<details[^>]*\bopen\b/)
  })

  it('names components only when there are some', () => {
    expect(de.home.size).toMatch(/components, plural, =0 \{\}/)
    expect(en.home.size).toMatch(/components, plural, =0 \{\}/)
  })

  it('names the row action by its verb only: the sentence beside it already says what and how many', () => {
    for (const messages of [de, en]) {
      for (const label of Object.values(messages.home.go)) expect(label).not.toMatch(/[{#\d]/)
    }
    expect(page).toMatch(/\{t\(`go\.\$\{step\.kind\}`\)\}/)
    expect(page).toMatch(/\{` \(\$\{project\.name\}\)`\}/)
  })

  it('shows the surfaces that feed each project, a dashed circle and a hidden word for those not connected', () => {
    expect(page).toMatch(/<ToolIcon tool=\{mark\(line\.id\)\} \/> : <CircleDashed aria-hidden="true" \/>/)
    expect(page).toMatch(/t\('connected'\) : t\('notConnected'\)/)
    expect(page).toMatch(/format\.relativeTime\(last, /)
  })

  it('lines up name, sentence and action on one baseline', () => {
    const css = readFileSync(join(src, 'components/home.module.css'), 'utf8')
    expect(css).toMatch(/\.row \{[^}]*align-items: first baseline;/)
  })

  it('lists the projects in the sidebar on the project list, with the one count: open decisions', () => {
    expect(shell).toMatch(
      /\{!project && projects\.length > 0 && \(\s*<nav aria-labelledby="sidebar-projects"/,
    )
    expect(shell).toMatch(/t\('shell\.needsYou', \{ count: open \}\)/)
  })
})

describe('simplicity: the inbox filter is a quiet state, not a control of its own', () => {
  const page = readFileSync(join(src, 'app/p/[project]/decisions/page.tsx'), 'utf8')

  it('reads ?source= through decisionSourceOf and keeps the filter on every row and on J/K', () => {
    expect(page).toMatch(/const source = decisionSourceOf\(query\.source\)/)
    expect(page).toMatch(/const base = decisionsHref\(project\.slug, source\)/)
    expect(page).toMatch(/const href = \(id: string\) => withDecision\(base, id\)/)
    expect(page).toMatch(/<InboxKeys [^\n]*? base=\{base\} \/>/)
  })

  it('shows "Nur Figma" as one removable link with the filter look, never a primary button', () => {
    const start = page.indexOf('{source && (')
    const bar = page.slice(start, page.indexOf('</div>', start))
    expect(bar).toMatch(
      /<Link\s+href=\{projectHref\(project\.slug, 'decisions'\)\}\s+className=\{ui\.activeFilter\}/,
    )
    expect(bar).toMatch(/tp\('filter\.only'/)
    expect(bar).toMatch(/visually-hidden">\{tp\('filter\.clear'\)\}/)
    expect(bar).not.toMatch(/variant="primary"|<Button/)
  })

  it('names the filter the same way in German and English', () => {
    expect(de.proposals.filter.only).toBe('Nur {tool}')
    expect(en.proposals.filter.only).toBe('Only {tool}')
    expect(Object.keys(de.proposals.filter)).toEqual(Object.keys(en.proposals.filter))
    for (const tool of ['code', 'figma', 'pen', 'claude-design'] as const) {
      expect(de.proposals.tool[tool]).toBeTruthy()
      expect(en.proposals.tool[tool]).toBeTruthy()
    }
    expect(de.proposals.tool.pen).toBe('Pencil')
  })
})
