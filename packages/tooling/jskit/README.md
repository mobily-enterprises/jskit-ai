# @jskit-ai/jskit

Pack orchestration CLI for JSKIT apps.

## Commands

```bash
jskit list
jskit add <packId> [--<option> <value>]
jskit update <packId> [--<option> <value>]
jskit update --all
jskit remove <packId>
jskit doctor
```

## Options

- `--dry-run` plan changes only
- `--no-install` skip `npm install` during add/update
- `--<option> <value>` pass pack options defined by a pack (for example `db --provider mysql`)
- `--json` print structured output

## Built-in packs

- `db`
