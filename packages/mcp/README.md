# @decivo/accord-mcp

MCP server for [decivo Accord](https://github.com/decivo-i-G/decivo-accord#readme). Agents read tokens, component contracts and decisions (with their reasons) and check their changes before every commit.

| Tool | Purpose |
| --- | --- |
| `get_tokens(scope?)` | tokens with value, CSS variable and owner |
| `get_component_contract(name)` | the contract of a component |
| `get_decisions(scope?)` | decisions with `why`, filtered by token, component or file |
| `check_change(paths? \| diff?)` | violations with the fix, e.g. `src/components/Hero.tsx:12:5 #487a98 → color.brand.600 (var(--brand-blue))` |

Set up in Claude Code, inside the product repository:

```sh
claude mcp add accord -- npx @decivo/accord-mcp --root .
# from source: claude mcp add accord -- node /path/to/decivo-accord/packages/mcp/dist/bin.js --root .
```

Options: `--root <dir>` (default: `ACCORD_ROOT`, else the working directory) and `--register <dir>` (default `.accord`).
