# Report format (`accord.report/1`)

`accord report` turns the drift report into one JSON document. By default it prints that document. It sends it only when you give it an address, so you can build your own receiver: a dashboard, a chat bot, a review tool, anything that accepts an HTTP POST.

```bash
accord report --json                                            # print, send nothing
accord report                                                   # same: no URL, nothing leaves the machine
ACCORD_REPORT_TOKEN=… accord report --url https://example.com/hooks/accord
```

In GitHub Actions, set the Action inputs `report-url` and `report-token` (see [packages/action/README.md](../packages/action/README.md)).

## The request

| | |
| --- | --- |
| Method | `POST` |
| URL | exactly the one you configured (`--url` or `ACCORD_REPORT_URL`). Accord adds no path and changes nothing in it. |
| Scheme | `https` only. Plain `http` is accepted for `localhost`, `127.0.0.1` and `::1`, so a receiver on your own machine works. Anything else is refused before a connection is made, because the report and the token would travel unencrypted. |
| `content-type` | `application/json` |
| `authorization` | `Bearer <token>` when a token is set, otherwise no auth header. The token is read from the environment only (`ACCORD_REPORT_TOKEN`, or the variable named with `--token-env`), never from a flag value, so it stays out of shell history and process lists. |
| Body | the payload below, as compact JSON |

## The response

- **Any 2xx** counts as delivered. If the body is JSON with a boolean `created`, Accord prints "new" (`true`) or "replaced" (`false`); otherwise it prints the HTTP status.
- **Anything else** fails with exit code 2. If the body is JSON with a string `message`, Accord shows it, so your receiver can explain what is wrong (for example a revoked token). A network failure also exits with 2.
- The token never appears in Accord's error messages, even when the receiver echoes it back. The address in error messages leaves out credentials and the query string.

## The payload

The schema name stays `accord.report/1` as long as fields are only added. Removing or renaming a field needs a new schema name. A receiver should ignore fields it does not know.

```jsonc
{
  "schema": "accord.report/1",
  "accord_version": "0.1.0",
  "commit": "3f2c…",              // full SHA
  "branch": "feat/landing",
  "default_branch": "main",
  "source": "action",             // "action" or "cli"
  "generated_at": "2026-10-20T10:00:00.000Z",
  "report": {
    "generatedAt": "2026-10-20T10:00:00.000Z",
    "register": { "tokens": 40, "components": 6, "decisions": 3 },
    "health": { "score": 81 },
    "code": {
      "tokensCovered": 30,
      "tokensInSync": 27,
      "drift": [ /* see below */ ],
      "missing": ["radius.lg"],
      "hardValues": [ /* see below */ ],
      "hardValueSummary": { "total": 3, "exact": 1, "near": 1, "none": 1, "files": 3 },
      "inlineOnly": { "total": 2, "files": [{ "file": "emails/welcome.tsx", "count": 2 }] },
      "allowed": { "total": 1, "reasons": [{ "reason": "third-party widget", "count": 1 }] },
      "adoption": { "tokenUses": 40, "hardColours": 2, "rate": 0.95 },
      "filesScanned": 9
    }
  },
  "proposals": [ /* see below */ ]
}
```

A complete example is the compatibility snapshot in [packages/cli/test/fixtures/report-payload-v1.json](../packages/cli/test/fixtures/report-payload-v1.json).

### Top level

| Field | Meaning |
| --- | --- |
| `schema` | always `accord.report/1` |
| `accord_version` | version of the Accord CLI that built the report |
| `commit`, `branch`, `default_branch` | where the report comes from. In GitHub Actions taken from the run, otherwise from git; override with `--commit`, `--branch`, `--default-branch`. |
| `source` | `action` (the GitHub Action) or `cli` (by hand); set with `--source` |
| `generated_at` | when the report was built (ISO 8601) |

### `report`

| Field | Meaning |
| --- | --- |
| `register.tokens`, `.components`, `.decisions` | counts in the register |
| `health.score` | preliminary health score, an integer from 0 to 100 |
| `code.tokensCovered` | tokens the code defines as CSS variables |
| `code.tokensInSync` | of those, tokens whose value matches the register |
| `code.drift[]` | differences between register and code: `path` (token path), `kind` (e.g. `token.value_changed`), `origin` (`surface`, `register`, `conflict`, `unknown`), `owner` (`design`, `code`, `register`), `breaking`, `reason`; for a changed value also `register` and `surface` (both values as text) |
| `code.missing[]` | token paths the code does not define |
| `code.hardValues[]` | hard-coded values in UI code: `file`, `line`, `column`, `raw` (the value, e.g. `#487a98`), `kind` (`color` or `dimension`), optional `replacement` (a token with exactly this value) and `near` (`path` and `distance` of a close token) |
| `code.hardValueSummary` | counts over **all** hard values, before any cap: `total`, `exact`, `near`, `none`, `files` |
| `code.inlineOnly` | hard values in e-mail, PDF and OG-image code, where CSS variables do not work: `total` and `files[]` with `file` and `count` |
| `code.allowed` | hard values covered by an `allow` rule: `total` and `reasons[]` with the rule's `reason` and `count` |
| `code.adoption` | `tokenUses`, `hardColours` and `rate` (share of colour usages that go through a token) |
| `code.filesScanned` | number of files scanned |

### `proposals[]`

Open proposals that need a person: Claude Design handoffs routed to their owner and not decided yet. A decided proposal is not sent again. Figma and Pencil proposals are not part of `accord.report/1` yet.

| Field | Meaning |
| --- | --- |
| `id` | proposal id, the file name in `.accord/proposals/` |
| `source` | `claude-design` |
| `title` | e.g. `Landing (Claude Design)` |
| `route` | `owner` |
| `decider` | `design`, `code` or `register`, when known |
| `breaking` | `false` for handoff proposals |
| `colors[]` | colours in the draft: `after` (hex), and when a close register token exists `token` and `before` (its hex value); `count` |
| `rules[]` | register rules the draft breaks: `id`, `rule`, `why` |
| `recommendation` | `option` (`adopt`, `reset` or `ask`) and `reason` |

To act on a proposal, run `accord apply`, decide it in the web app, or start `templates/github/accord-apply.yml` with an `accord.resolution/1` payload.

## Limits

Lists are capped so a large repository still reports instead of failing. The summary counts are never capped.

| List | At most |
| --- | --- |
| `code.drift`, `code.missing`, `code.inlineOnly.files` | 500 entries each |
| `code.hardValues` | 3000 entries; a value longer than 64 characters is left out |
| `proposals` | 50 |
| `proposals[].colors` | 20 per proposal, hex colours only |

## Privacy: what is sent and what never is

Sent, and only to the URL you configure:

- counts, token paths, file paths, line and column numbers
- the hard-coded values themselves (e.g. `#487a98`, `13px`) and token values
- register rule texts and their reasons (`rule`, `why`), and the reasons of your `allow` rules
- commit SHA, branch names, Accord version

Never sent:

- source lines or any other file content (the scanner's `context` line is dropped)
- CSS variables that map to no token
- anything from a Claude Design bundle except hex colours, the bundle name and the rules it breaks
- the token in the body; it is only in the `authorization` header

Without a URL nothing is sent at all. Every other command, the web app and the MCP server work without one.
