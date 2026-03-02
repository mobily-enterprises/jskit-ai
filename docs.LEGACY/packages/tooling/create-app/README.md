# @jskit-ai/create-app

Scaffold a minimal JSKIT app shell from in-repo templates.

## Usage

```bash
jskit-create-app my-app
```

```bash
jskit-create-app --interactive
```

## Options

- `--template <name>` template name under `templates/` (default `base-shell`)
- `--title <text>` override the generated app title placeholder
- `--target <path>` output directory (default `./<app-name>`)
- `--initial-bundles <preset>` optional framework preset: `none`, `db`, or `db-auth`
- `--db-provider <provider>` provider for `db` presets: `mysql` or `postgres`
- `--force` allow writes into non-empty target directories
- `--dry-run` preview writes only
- `--interactive` prompt for app values
