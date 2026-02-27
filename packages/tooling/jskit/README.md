# @jskit-ai/jskit

Bundle/package orchestration CLI for JSKIT apps.

## Commands

```bash
jskit list bundles
jskit list bundles all
jskit list bundles --full
jskit list packages
jskit add bundle <bundleId> [--<option> <value>]
jskit show bundle <bundleId>
jskit add package <packageId> [--<option> <value>]
jskit update package <packageId> [--<option> <value>]
jskit remove package <packageId>
jskit doctor
```

## Options

- `--dry-run` plan changes only
- `--no-install` skip `npm install` during add/update
- `--full` include full package ids when listing bundles
- `--<option> <value>` pass package options for selected bundle/package graph
- `--json` print structured output

## Built-in Bundles

- `db-mysql`
- `db-postgres`

## DB Layering

- Feature modules depend on `@jskit-ai/jskit-knex` only.
- Provider bundles (`db-mysql`, `db-postgres`) satisfy `db-provider`.
- Dialect-coupled imports (`...mysql...`, `...postgres...`) are forbidden in merged core packages.
