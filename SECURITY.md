# Security policy

Accord reads files that come from outside your team's control: Figma files, exports, Pencil files and Claude Design handoff bundles. It treats them as untrusted data. Parsers are bounds-checked, never execute content, and never follow instructions found in it.

## Report a vulnerability

Please do **not** open a public issue. Use GitHub's private vulnerability reporting under this repository's *Security* tab (*Report a vulnerability*). We confirm receipt within three working days and keep you informed until a fix is released.

Useful to include:

- the affected command or package and its version (`accord --version`)
- a minimal file or steps that reproduce it
- what an attacker gains: code execution, reading or writing files outside the repository, leaking data to `accord report`, denial of service

## Scope

- `packages/*`: CLI, MCP server, GitHub Action, adapters and parsers.
- `accord report` sends nothing unless you configure a URL (`--url` or `ACCORD_REPORT_URL`), and then only to that URL, over https (plain http only to localhost). It sends metadata: counts, paths, line numbers, values and token names, never source lines (see [docs/report-format.md](docs/report-format.md)). The token is read from the environment only and never printed. Anything else leaving the repository, or the report or token going anywhere but the configured URL, is a vulnerability.

Supported versions: the latest release and `main`.
