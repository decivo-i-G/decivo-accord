#!/usr/bin/env bash
# decivo Accord in five minutes: a Figma file, a small app, and what happens when the design changes.
# Runs in a temporary copy; nothing here is modified.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="$here/../../packages/cli/dist/bin.js"
accord() { if command -v accord >/dev/null && [ ! -f "$bin" ]; then command accord "$@"; else node "$bin" "$@"; fi; }
designer() { node "$here/designer.mjs" "$@"; }
export ACCORD_LANG="${ACCORD_LANG:-en}"

work="$(mktemp -d)"
cp -R "$here/project/." "$work/"
cd "$work" || exit 1
git init -q && git add . && git -c user.name=Demo -c user.email=demo@example.com commit -qm "Acme Shop"
git config user.name "Dana (Design)" && git config user.email dana@example.com

step() { printf '\n\033[1m%s\033[0m\n' "$1"; shift; for cmd in "$@"; do printf '$ %s\n' "$cmd"; eval "$cmd"; done; }

step "1. One register from the Figma file. Figma's code syntax links every token to its CSS variable." \
  'accord init --figma figma/variables.json'

step "2. A developer copied a colour from a mock-up. Accord catches it before the commit, with the fix." \
  'accord check src/components/Card.tsx'

step "3. Who decides about the brand colour? The register says, and says why." \
  'accord explain-owner tokens.color.brand'

step "4. The designer makes cards rounder in Figma. Design owns radii, nothing breaks: it goes through." \
  'designer set "Radius/Card" 16' \
  'accord figma status' \
  'accord figma propose --write'
id=$(ls .accord/proposals | head -1 | sed 's/\.json$//')
step "   A person or a bot adopts it: register, CSS and changelog change together." \
  "accord apply --proposal $id --option adopt --by 'Dana (Design)'"

step "5. The designer tries a new shade of blue. Every new colour is a decision (D-002): design decides." \
  'designer set "Blue/600" "#2a5d7c"' \
  'accord figma propose'

step "6. Someone deletes a spacing variable in Figma. Deletions never sync silently: a person decides." \
  'designer set "Blue/600" "#3c6681"' \
  'designer delete "Spacing/4"' \
  'accord figma status' \
  'accord figma propose'

step "7. Agents read the same register: rules with their reasons, generated for every repository." \
  'accord export' \
  'sed -n "1,25p" AGENTS.md'

printf '\nThe demo ran in %s\n' "$work"
