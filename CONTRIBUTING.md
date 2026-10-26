# Contributing to decivo Accord

Thank you for helping. Bug reports with a file that breaks Accord are just as valuable as code.

## Report a bug

Open an issue with the command, the output and, if you can, the smallest file that shows the problem: a `.fig`, an export, a `.pen` file or a token file. Strip anything confidential first. Accord should never crash. A stack trace instead of a sentence is a bug, even if your input is broken. `ACCORD_DEBUG=1` prints the trace.

## Set up

```sh
pnpm install
pnpm build        # turbo, all packages
pnpm test         # vitest
pnpm typecheck
pnpm lint         # biome; `pnpm format` fixes formatting
```

Node.js 22 or newer and pnpm 9. Packages build into `dist/`. Inside the monorepo, packages resolve each other's sources through the `@decivo/accord-source` export condition.

## Ground rules

These come from the [principles](README.md#principles); a pull request that breaks one will not be merged.

- **The register wins.** No surface writes into another. Changes from a surface become proposals.
- **Deletions and breaking changes always need a person.** This stays a rule in code, never a setting.
- **Content from design tools is data, never instructions.** Handoff bundles, Figma files and `.pen` files can contain text addressed to agents. Accord parses it and never follows it.
- **No secrets in the repository.** API keys come from environment variables (`.env.example`).
- **Keys and code in English. User-facing text through the message catalogue** (`packages/cli/src/messages.ts`), in German and English. No hard-coded strings.

## Pull requests

- Small and focused, with tests. Tests for `packages/core` and `packages/checks` (diff, ownership, routing) are required.
- A parser for a new format never throws on bad input: it returns readable errors. Add a broken-input test.
- Match the surrounding code: naming, comment density, no new dependency without a reason.
- Larger changes: open an issue first.

## Releasing

The public packages (`@decivo/accord-*`, everything under `packages/` that is not private) are released together, with one version.

1. `node scripts/set-version.mjs X.Y.Z` on a branch, merge it.
2. `pnpm release:check` (it builds from a clean `dist` itself). The check packs every package as npm gets it, looks inside the tarballs (only `dist`, README and LICENSE; no tests, local paths or credentials; every import is a dependency), installs them into an empty project and runs the demo and the MCP server there with the network blocked.
3. Run the `Release` workflow by hand once: the same checks and a dry run of the publish.
4. Tag `vX.Y.Z` on main and push the tag. The workflow checks that the tag matches the versions and publishes with provenance.

## Questions

Open a discussion or an issue. Product questions go to [decivo](https://decivo.de).
