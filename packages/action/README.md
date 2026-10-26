# decivo Accord – GitHub Action

A red check for `must` violations (for example hard-coded colours in components), with an annotation on the line and the fix, plus a summary on the job page. Only lines the pull request adds are checked.

```yaml
# .github/workflows/accord.yml
name: Accord
on: pull_request
jobs:
  accord:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v6
      - uses: decivo-i-G/decivo-accord/packages/action@main
```

Inputs: `register` (default `.accord`), `root`, `version` (default `source`), `node-version`, and optionally `report-url`, `report-token`.

**Source mode (default):** the Action builds Accord from its own repository, so no npm package is needed. Run `pnpm/action-setup` before it. Once `@decivo/accord-cli` is on npm, set `version: latest`.

**Send the report to a webhook (optional):** with `report-url`, the Action POSTs the drift report to exactly that https address after every run (`accord report`), also when the check is red. Without `report-url` nothing is sent. `report-token` is optional and goes out as `Authorization: Bearer <token>`; pass it from a secret, for example `secrets.ACCORD_REPORT_TOKEN`, and keep the URL in the variable `ACCORD_REPORT_URL`. Only counts, paths, line numbers, values and token names are sent, never source lines; the format is in [docs/report-format.md](../../docs/report-format.md). To report the main branch too, also run the Action on `push` to `main` (see `templates/github/accord.yml`). Locally: `ACCORD_REPORT_TOKEN=… accord report --url https://…`, or `accord report --json` to look first.

<details><summary>Deutsch</summary>

Roter Check bei Muss-Verstößen (z. B. harte Farbwerte in Komponenten), mit Anmerkung an der Zeile und Ersatzvorschlag; Zusammenfassung auf der Job-Seite. Geprüft werden nur hinzugefügte Zeilen des Pull Requests.

```yaml
# .github/workflows/accord.yml
name: Accord
on: pull_request
jobs:
  accord:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: decivo-i-G/decivo-accord/packages/action@main
```

Eingaben: `register` (Standard `.accord`), `root`, `version` (Standard `source`), `node-version`, optional `report-url`, `report-token`.

**Bericht an einen Webhook senden (optional):** Mit `report-url` schickt die Action nach jedem Lauf den Drift-Bericht per POST an genau diese https-Adresse (`accord report`), auch wenn der Check rot ist. Ohne `report-url` wird nichts gesendet. `report-token` ist optional und geht als `Authorization: Bearer <token>` hinaus; aus einem Secret übergeben, z. B. `secrets.ACCORD_REPORT_TOKEN`, die Adresse in der Variable `ACCORD_REPORT_URL`. Gesendet werden nur Zahlen, Pfade, Zeilennummern, Werte und Token-Namen, nie Quellcode-Zeilen; das Format steht in [docs/report-format.md](../../docs/report-format.md). Damit auch der Hauptbranch gemeldet wird, die Action auch bei `push` auf `main` laufen lassen (siehe `templates/github/accord.yml`). Lokal: `ACCORD_REPORT_TOKEN=… accord report --url https://…` oder `accord report --json` zum Ansehen.

**Quellmodus (Standard):** Die Action baut Accord aus ihrem eigenen Repo, kein npm nötig. Für private Nutzung muss im Repo `decivo-i-G/decivo-accord` unter *Settings → Actions → Access* der Zugriff aus anderen Repositories der Organisation erlaubt sein. Vor der Action `pnpm/action-setup@v6` ausführen. Sobald `@decivo/accord-cli` auf npm liegt, `version: latest` setzen.

</details>
