# @decivo/accord-cli

`accord`: the command line of [decivo Accord](https://github.com/decivo-i-G/decivo-accord#readme), the register for design decisions that people and agents check against.

```sh
accord init                 # create the register (.accord/) from code, token files, Figma or Pencil
accord diff                 # drift: register against code
accord check src/           # hard-coded values and rule violations, with the fix
accord figma propose        # what changed in Figma since the last sync, as a proposal
accord apply --proposal <id> --option adopt --by "Name"
accord export               # DESIGN.md, AGENTS.md, CLAUDE.md block, CSS, CHANGELOG.md
```

All commands: [command reference](https://github.com/decivo-i-G/decivo-accord#command-reference). Options for every command: `-C, --root <dir>` and `-r, --register <dir>` (default `.accord`). The language is German for German locales and English otherwise; `ACCORD_LANG=de|en` overrides.
