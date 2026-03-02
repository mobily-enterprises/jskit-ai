# Framework CLI Command Contracts

Status: proposed

These commands define the expected CLI surface for app-manifest/pack-driven composition.

## Command Family

Commands are exposed as app scripts through `jskit-app-scripts` tasks.

Example:

```bash
npm run framework:manifest:check -- --json
```

## 1) `framework:manifest:check`

Validate `apps/<app>/framework/app.manifest.mjs` and print resolved composition.

### Args

- `--json` output structured JSON
- `--mode strict|permissive` override manifest mode

### Exit codes

- `0` valid manifest
- `1` invalid manifest or unresolved composition

### JSON output (contract)

```json
{
  "ok": true,
  "appId": "base-app",
  "profileId": "web-saas-default",
  "mode": "strict",
  "moduleOrder": ["auth", "workspace"],
  "disabledModules": [],
  "diagnostics": []
}
```

## 2) `framework:deps:check`

Validate dependency and capability graphs for resolved modules.

### Args

- `--profile <id>`
- `--packs <csv>`
- `--enabled <csv>`
- `--mode strict|permissive`
- `--json`

### Exit codes

- `0` no blocking graph errors
- `1` graph invalid in selected mode

## 3) `framework:packs:list`

List available pack descriptors visible to current app.

### Args

- `--json`

### Exit codes

- `0` success
- `1` descriptor discovery/parse failure

## 4) `framework:packs:add`

Enable one pack for current app and apply deterministic scaffolding updates.

### Args

- `--pack <packId>` required
- `--manifest <path>` optional override
- `--yes` skip confirmation
- `--dry-run` print planned changes only
- `--json`

### Expected changes

- updates `app.manifest` pack selection
- updates app dependencies if descriptor requests it
- initializes missing required files from templates when needed

### Exit codes

- `0` success
- `1` invalid pack, failed patch, or failed post-check

## 5) `framework:packs:remove`

Disable one pack and run safety checks for remaining composition.

### Args

- `--pack <packId>` required
- `--yes`
- `--dry-run`
- `--json`

### Exit codes

- `0` success
- `1` removal would break required modules/capabilities or patch failed

## 6) `framework:migrations:list`

Resolve migration sources from enabled packs/modules and print ordered plan.

### Args

- `--json`

### Exit codes

- `0` success
- `1` source resolution failure

## 7) `framework:migrations:run`

Run ordered migration plan for enabled packs/modules.

### Args

- `--dry-run`
- `--to <target>` optional target step
- `--json`

### Exit codes

- `0` success
- `1` migration failure

## Safety Rules (for add/remove/run)

- Commands must be idempotent where feasible.
- File edits must be deterministic and minimal-diff.
- Commands must print touched files.
- `--dry-run` must make no filesystem changes.
- Any failure must include actionable diagnostics and next command suggestions.
