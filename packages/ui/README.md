# @decivo/accord-ui

The web app of [decivo Accord](https://github.com/decivo-i-G/decivo-accord#readme) on your machine: overview, decisions and register of a repository in the browser. No account, no database, no server on the internet.

Usually you start it through the CLI, inside the repository:

```sh
npx @decivo/accord-cli ui
```

or directly:

```sh
npx @decivo/accord-ui [folder …] [--port <n>] [--no-open]
```

- Shows the repository the folder belongs to (several folders, several projects). Without a register it says how to create one (`accord init`).
- Deciding on a proposal writes the same files as `accord apply`: register, CSS, DESIGN.md, AGENTS.md, CHANGELOG.md. No branch, no commit; that stays with you.
- Listens on `127.0.0.1` only, port 4317 or the next free one. A random token per start is part of the printed address; without it, and from any other address, the app answers nothing. `Ctrl+C` stops it.

Node.js 22 or newer.
