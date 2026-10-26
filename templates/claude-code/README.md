# Vorlagen für Claude Code im Kunden-Repo

- `skills/accord-handoff/` – Handoff aus Claude Design als Vorschlag einlesen (`accord ingest --branch`)
- `skills/accord-design-sync/` – Design-System-Projekt abgleichen und zurücksetzen (`accord design status|reset|lock`)

Nach `.claude/skills/` im Kunden-Repo kopieren. Den MCP-Server einrichten: `claude mcp add accord -- npx @decivo/accord-mcp --root .`
Die Regeln für Agenten (AGENTS.md, CLAUDE.md-Block) erzeugt `accord export`.

## GitHub-Workflows (`templates/github/`)

- `accord.yml`: prüft jeden Pull Request gegen das Register und schickt den Bericht optional an eine eigene https-Adresse (`report-url`, siehe `docs/report-format.md`).
- `accord-apply.yml`: übernimmt eine Entscheidung (`workflow_dispatch` mit `accord.resolution/1`, gestartet von einem Review-Werkzeug oder einem Menschen) per `accord apply` auf einem eigenen Branch und öffnet den Pull Request. Wer ihn startet, braucht dafür nur „Actions: write“.
