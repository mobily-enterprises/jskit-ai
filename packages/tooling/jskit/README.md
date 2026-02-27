# @jskit-ai/jskit

Bundle/package orchestration CLI for JSKIT apps.

## Commands

```bash
jskit list [bundles|packages]
jskit add bundle <bundleId> [--<option> <value>]
jskit add package <packageId> [--<option> <value>]
jskit update package <packageId> [--<option> <value>]
jskit remove package <packageId>
jskit doctor
```

## Options

- `--dry-run` plan changes only
- `--no-install` skip `npm install` during add/update
- `--<option> <value>` pass package options for selected bundle/package graph
- `--json` print structured output

## Built-in Bundles

- `db-mysql`
- `db-postgres`
