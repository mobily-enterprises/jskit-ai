# Upgrade guide from Beta 1 to Final Release

> Temporary migration guide. Delete this page after every maintained application has upgraded to the Final Release package model.

This is a one-way upgrade. Final Release does not read, translate, or preserve Beta 1 JSKIT state.

## 1. Start from a clean commit

Commit or stash application work. Record the current database migration status and make a normal database backup before changing packages.

Do not run a Final Release JSKIT command until the package manifests have been converted.

## 2. Move package metadata into package.json

For every JSKIT package, move the exported metadata from `package.descriptor.mjs` into the package's top-level `jskit` object.

Keep identity in standard npm fields:

```json
{
  "name": "@acme/example-core",
  "version": "1.2.3",
  "description": "Example runtime package.",
  "jskit": {
    "kind": "runtime",
    "capabilities": {
      "provides": [],
      "requires": []
    },
    "runtime": {
      "server": { "providers": [] },
      "client": { "providers": [] }
    },
    "mutations": {
      "dependencies": { "runtime": {}, "dev": {} },
      "files": []
    }
  }
}
```

Remove `packageId`, `version`, and `description` from the moved object. Delete every `package.descriptor.mjs` after its data is represented in `package.json`.

## 3. Use npm dependencies for package relationships

Move every package relationship from `jskit.dependsOn` to the appropriate standard npm field:

- `dependencies` for required runtime packages;
- `optionalDependencies` for optional runtime integrations;
- `peerDependencies` for host-provided libraries;
- `devDependencies` for build and generator tooling.

Pin `@jskit-ai/*` packages to exact versions. Remove `jskit.dependsOn` completely.

Keep provider-class `static dependsOn` declarations. Those order providers inside the runtime container and are not npm package relationships.

## 4. Remove Beta 1 project state

Delete these paths from the application:

```text
.jskit/lock.json
.jskit/verification/
```

Remove ignore rules created solely for `.jskit/verification/`.

Do not translate either file into a replacement. Final Release derives package state from `package.json`, `package-lock.json`, installed package manifests, application config, migration files, and generated CI.

## 5. Replace command usage

Update scripts, workflow files, runbooks, and automation:

| Beta 1 | Final Release |
| --- | --- |
| `jskit package migrations ...` | `jskit migrations sync` |
| `jskit app sync-ci` | `jskit ci generate` |
| CI drift validation through `doctor` alone | `jskit migrations sync --check` and `jskit ci generate --check` |
| `jskit update package ...` | update npm versions explicitly or run `jskit app update-packages` |
| `jskit position element ...` | edit application-owned placements directly |
| `jskit app verify-ui ...` | run the application's Playwright command directly |

Delete automation for package adoption, source-mutation migration, managed-script adoption, UI receipts, or package replay. Final Release has no corresponding commands.

## 6. Install the coordinated Final Release

Update every direct `@jskit-ai/*` dependency in the root application and npm workspaces to the coordinated Final Release versions, then install from scratch with the application's normal npm workflow:

```bash
npm install
npm ls
```

Resolve npm peer or capability errors as package-graph errors. Do not add overrides that mix Beta 1 and Final Release packages.

## 7. Generate deterministic projections

Synchronize package migration files without applying them:

```bash
npx jskit migrations sync
```

Review the migration diff. Existing Knex migration files and migration-table history remain intact.

Generate the JSKIT CI workflow:

```bash
npx jskit ci generate
```

Move application-specific CI into separate workflow files. The generated JSKIT workflow is replaced in full whenever this command runs.

## 8. Verify the application

```bash
npx jskit lint-packages
npx jskit doctor
npx jskit migrations sync --check
npx jskit ci generate --check
npm run verify
```

Run the application's Playwright suite directly for UI changes.

Apply database migrations only after reviewing the synchronized files:

```bash
npm run db:migrate
```

Commit package manifests, `package-lock.json`, synchronized migrations, generated CI, and required application changes together.
