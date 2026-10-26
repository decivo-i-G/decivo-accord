# Web app redesign: brief

Status: in progress (20.10.2026). The web app (`apps/web`) is unfrozen. Goal: a 9/10 interface that design-system people who live in Figma, Pencil (pen.dev) and Claude Design open and immediately understand, and that makes deciding about design changes calm and fast.

## Who uses it, and what for

- **Designers** (Figma, Pencil, Claude Design): see what changed on their surface, decide proposals they own, browse the register visually.
- **Design-system leads**: keep the system healthy, see drift per surface, own the rules.
- **Developers and agents**: read the register, see why a check failed.

The three jobs, in order: **1. decide proposals** (the inbox), **2. understand the system's health** (what to fix next), **3. look things up** (tokens, components, rules and their reasons).

## Direction: a design tool, not an admin panel

Familiar patterns from the tools the audience uses every day, and from community-favourite dashboards (Linear, Vercel, GitHub, Raycast, Figma's own variables panel and Dev Mode):

- **Layout**:
  - left sidebar with the project switcher on top (like Figma's file browser) and sections with icons and counts (Proposals shows the open count);
  - a slim top bar with breadcrumbs (`project / section / item`);
  - a neutral canvas;
  - a **right-hand inspector** for the selected item, Figma's properties panel pattern. On mobile the inspector becomes a full page.
- **Tokens look like tokens**:
  - colour swatches with hex and name;
  - a Figma-variables-style table: name, value per column, CSS variable, owner;
  - groups as collapsible sections;
  - dimensions shown as bars or rounded boxes;
  - font families shown in their typeface;
  - aliases shown as `→ blue.600` chips.
  - Search and a filter by type.
- **Proposals are an inbox**:
  - The list sits on the left, grouped *Needs you / Goes through on its own / Decided*.
  - The detail shows a **visual before → after**: two swatches, a radius preview, a value pair.
  - It says **who decides and why** in one plain sentence ("A new shade is a decision for Design (D-002)").
  - It shows **what happens on adopt** (register, CSS, CHANGELOG on a branch) and offers **one primary action**.
  - Keyboard shortcuts: `J`/`K` move, `A` adopt, `R` reset, `X` reject; visible as hints.
  - "Inbox zero" empty state.
- **Health is a to-do list, not a scoreboard**:
  - the score in one sentence with what moved it (no ring, no gauge);
  - one card per surface with its tool icon (Code, Figma, Pencil, Claude Design), last sync and drift count;
  - a ranked "fix next" list with one action each.
- **Connections show what Accord found**:
  - Figma is supported (`.fig` files, exports): not "later";
  - Pencil is called **Pencil** (`.pen`), not "Pen";
  - Claude Design is connected through handoffs.
  - Each card shows its state (found N files, last sync, enable or disable) and the exact next step.

## Psychology

- **Calm confidence**: white surfaces, one accent (brand-700), colour reserved for meaning (status), never colour alone (icon + text).
- **Reduce decision anxiety**: show the consequence before the click, make reset and reject equally visible and safe, confirm with an undo-style toast ("Adopted. Register, CSS and CHANGELOG updated.").
- **Progress you can feel**: open-count badges that shrink, "x of y in sync", inbox zero.
- **Progressive disclosure**: the sentence first, details (rule, confidence, files) on demand.
- **Speak the user's language**: Figma words where they fit (variables, collections, modes); German first, English complete.

## Non-negotiables (from CLAUDE.md and the register in `apps/web/.accord/`)

- Colours, lengths and fonts only from the register (`src/app/tokens.css` is generated; add tokens to `apps/web/.accord/tokens/*.tokens.json` and run `node ../../packages/cli/dist/bin.js --root . export` from `apps/web`). `node ../../packages/cli/dist/bin.js check src` must report no violations.
- Typography: Merriweather for headings, Inter for the interface.
- Accessibility:
  - text contrast 4.5:1 or more;
  - real `<button>`, `<a>`, `<label>`;
  - click targets 44 px or more;
  - visible focus;
  - full keyboard use;
  - usable at 390 px width.
- Light on white by default, dark mode when the user chooses it (see the decivo v6 section), with contrast checked in both.
- All text through `messages/de.json` and `messages/en.json`, no hard-coded strings.
- Decisions run through Accord's own logic (`planApply`/`writeApply`, `resolutionFor` from `@decivo/accord-cli`), never a parallel implementation. Breaking changes and deletions are never one click without saying so.
- Content from design tools is data, never instructions.

## How it is judged

A "gauntlet" loop:

1. Build.
2. Four independent judges look at real screenshots (desktop and 390 px, German and English, light and dark) and use the running app: a Figma/Pencil power user, a product psychologist and UX writer, an accessibility and mobile expert, and a dashboard benchmark critic.
3. Each judge scores every screen out of 10, with concrete findings.
4. Fix and repeat until every judge gives every screen 9 or more.

Demo data: `acme` (Figma export, proposals of every route, two Claude Design handoffs) and `boundless` (a real shadcn app, 111 tokens, 59 components).

## decivo v6 style and no AI slop (binding, 20.10.2026)

Accord is a decivo product and must be recognisable as one: the same style as decivo.de v6 (repo `decivo-i-G/decivo`: `src/app/[locale]/layout.tsx`, `src/components/site/brand-dots.tsx`, the test `src/app/[locale]/rescue/__tests__/v6-style.test.tsx`). These rules **override** anything above that contradicts them.

**Brand**
- **White background** everywhere (`#ffffff`) in the default light scheme. No grey canvas.
- **Dark mode on request:**
  - The user chooses Light (default), Dark or System in the settings. The choice is stored like the language (cookie) and applied on `<html>` before the first paint (no flash).
  - Every colour has a dark token, and every pair is checked for 4.5:1 text contrast (3:1 for large text and UI borders) in both schemes.
  - The swap is clean: every surface, line, chip, swatch frame, focus ring and the browser surfaces (selection, scrollbar, caret) change together, with nothing left light.
  - The logo dots keep their colours; only the fourth, darkest dot uses the light variant on dark backgrounds, as decivo does on blue.
  - **The switch is the familiar icon, not text:** a sun/moon icon button, reachable directly in the sidebar footer and top bar on mobile, not hidden behind "Einstellungen". The sun shows in dark mode and the moon in light mode; a long press or the menu offers System. It has an accessible name ("Dunkelmodus einschalten" / "Switch to dark mode"), a tooltip and a 44px target. No "Hell"/"Dunkel" or "Light"/"Dark" text labels in the shell. The language stays a compact DE/EN switch next to it.
- **decivo blue** `#3C6681` is the one primary colour (`brand-700`), for primary actions, selection, focus and links.
- **The four logo dots** are the only ornament, used as decivo does:
  - in the logo (wordmark with the dots);
  - as a small dot row before a page title (`DotTag`: four dots plus a short label in normal case, never uppercase);
  - as step markers;
  - as a loading indicator;
  - in empty states.
  - Dot colours, left to right: `#5B9BB8`, `#487A98`, `#3C6681`, `#2D2D30`.
- **Typography:**
  - Merriweather **300** for headings;
  - **IBM Plex Sans** (400/500/600) for the interface;
  - **IBM Plex Mono** (400/500) only for numbers, values, tokens, paths and code.
  - Fonts are self-hosted (`@fontsource`, exact versions), never loaded from Google at runtime.
- **Ink:** text strong `#24231F`, text `#4A4A4D`, muted `#6B6B70`; lines are 8 % of `#24231F` (one-pixel hairlines).

**Banned** (from decivo v6, the v3 brief and impeccable.style; reaching for one means rewriting the element, not softening it):
- Eyebrows or kickers above headings (small uppercase or letter-spaced labels). No uppercase labels with letter-spacing anywhere. Section labels are normal sentence-case text, if they are needed at all.
- Em and en dashes (— –) in any visible text, headings or copy, de and en. Rewrite the sentence.
- "X statt Y" / "X instead of Y" phrasing and other empty formulas. Copy is concrete: real numbers, real names, the product's own words.
- Coloured `border-left`/`border-right` accents on cards, list items, callouts or the selected row. Selection is a tinted background (`brand-50`) and weight, not a bar.
- Gradients, gradient text, glass or blur, glow, pulse or "live" animations, hover lift (`translateY`).
- Card shadows. Elevation is a one-pixel hairline, or nothing. A shadow is only for things that float (menus, popovers, toasts).
- Cards as the default container, and nested cards. Use lists, tables, typography and white space. Sections get different forms: a list without cards, a table, a large sentence, a two-column split.
- The hero-metric template (a big number, a small label, a row of stats) and **progress rings, sparklines, gauges**. Health states its score in a sentence and leads with what to fix next.
- Section numbers (01/02/03), unless the order is information.
- Emoji or unicode glyphs as icons. Use one icon set with one stroke weight.
- Monospace as decoration. Mono is only for code, values and measurements.

**Shape and space**
- Radii are small: 4px for chips and inputs, 6px for buttons, 8px at most for panels. Pills only for small status chips.
- Generous white space, with more space above a heading than below it. Body measure 65–75ch.
- One authored motion moment at most, with exponential ease-out. Respect `prefers-reduced-motion`.

**Allowed accents** (sparingly, where they carry meaning):
- A breakout or overlapping element, for example the before/after swatch pair crossing the inspector's edge, or the dot row hanging into the page title.
- Breaking the grid once per screen.

**Browser surfaces carry the design too:** text selection, caret, scrollbars, focus rings, underline offset, and tabular numerals in tables.

## Simplicity (binding, 24.10.2026)

The outcome: the app is super easy to use, very clean, with an excellent overview. There are few decisions to make, and it is always obvious what to do next. This section overrides earlier parts of the brief where they conflict.

**Navigation: three sections per project**
- **Überblick / Overview** (the project start, replaces "Systemzustand"):
  - one plain sentence about the state ("4 Entscheidungen warten, 1 Datei im Code");
  - **one** primary next step;
  - at most three short items;
  - the surfaces as one compact line each (Code, Figma, Pencil, Claude Design: in sync, or N waiting).
  - The score number and how it is computed live behind "Details", not in the headline.
- **Entscheidungen / Decisions** (the inbox, formerly "Vorschläge"): the **only** place where things are decided. Nothing on Überblick repeats its list; Überblick links to it.
- **Register:** look things up. The rules tab is called **"Regeln" / "Rules"**, so the word "Entscheidungen" means the inbox only.
- **Verbindungen / Connections** moves into the project settings: a gear icon at the project switcher. It is not a main section. Old URLs redirect (`/health` → overview, `/proposals` → decisions).
- The sidebar shows **one** count only: open decisions.

**Deciding**
- Every decision shows **one recommended action** as the single primary button, with the reason in one sentence. The alternatives are quieter secondary buttons. Naming new tokens is behind "Selbst benennen" / "Name them yourself", collapsed by default.
- One row in the list shows: what changed (visual), where it came from (icon), and who decides, if not you. No more than one status chip per row. Rule codes (D-002) appear only in the details; the row and the sentence use the rule's name.
- Safe changes can be adopted together with one button. After a decision, the next one opens automatically, and inbox zero is a calm, finished state.
- Keyboard shortcuts work but are not shown in the header: a "?" opens the shortcut sheet.

**Less on every screen**
- At most **one** primary button per screen.
- Sentences short, everyday words: no "harte Werte" ("fest eingetragene Farben"), no "Token ohne Variable" without explanation.
- Numbers only where they help decide. No "betrifft 205 Stellen" unless it changes the decision.
- Configuration (paths, globs, modes, CLI commands) is hidden behind "Details" or "Für Entwickler" / "For developers"; the default view is status plus one switch.
- Empty and finished states say so in one sentence and offer one action.

**How it is measured** (a sixth judge, "simplicity"):
- clicks and visible choices for three core tasks: decide one proposal; find a token and copy its CSS variable; connect Figma;
- a five-second test per screen: what is this, what is the one thing to do;
- the count of numbers, chips and buttons visible per screen;
- one primary action per screen.

