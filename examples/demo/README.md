# Demo: one Figma file, one app, four design changes

```sh
pnpm install && pnpm build      # in the repository root
bash examples/demo/run.sh       # ACCORD_LANG=de for German
```

`run.sh` copies [`project/`](project/) into a temporary folder and runs real commands there. Nothing in the repository changes. The project is a small app ("Acme Shop") with:

- `figma/variables.json`: Figma variables as the REST API returns them. Primitives, a Light/Dark theme with aliases, a radius and a spacing token, and code syntax that names each CSS variable.
- `src/styles.css`: the CSS variables the app uses today.
- `src/components/Card.tsx`: a component with one colour copied from a mock-up.

[`designer.mjs`](designer.mjs) plays the designer: it changes the export the way a change in Figma would.

| Step | What happens | Why |
| --- | --- | --- |
| 1. `accord init --figma …` | The register comes from Figma; Figma's code syntax links 5 tokens to their CSS variables | one truth, in git |
| 2. `accord check` | `#3c6681 → color.brand (var(--brand))` | D-001: no hard-coded colours; the fix uses a variable the code really has |
| 3. `accord explain-owner` | `tokens.color.brand → design` | every property has one owner |
| 4. Radius 12 → 16 in Figma | `figma propose`: *can be applied automatically*; `apply` changes register, CSS and changelog | design owns radii, nothing breaks |
| 5. A new blue in Figma | *owner decides (design)* | D-002: every new colour is a decision |
| 6. A variable deleted in Figma | `[deleted in Figma]`, *owner decides (register)* | deletions always need a person |
| 7. `accord export` | AGENTS.md with the rules and their reasons | agents check against the same register |

The same works with a `.fig` file instead of the export: put it into the project and run `accord init` without arguments.
