# jskit CLI deep internals (machine-oriented)

## 1) top-level help surface
- `printTopLevelHelp()` emits:
  - `JSKit CLI`
  - `Use: jskit help <command> for command-specific usage.`
  - `Available commands:`
    - `create           Scaffold an app-local runtime package.`
    - `add              Install a runtime bundle or package into the current app.`
    - `generate         Run a generator package (or generator subcommand).`
    - `list             List bundles, runtime packages, or generator packages.`
    - `list-placements  List discovered UI placement targets.`
    - `list-link-items  List available placement link-item component tokens.`
    - `show             Show detailed metadata for a bundle or package.`
    - `migrations       Generate managed migration files only.`
    - `position         Re-apply positioning-only mutations for an installed package.`
    - `update           Re-apply one installed package.`
    - `remove           Remove one installed package.`
    - `doctor           Validate lockfile and managed-file integrity.`
    - `lint-descriptors Validate bundle and package descriptor contracts.`
  - `Global flags: --dry-run --run-npm-install --json --verbose --help`
- Command invocation path: `node_modules/@jskit-ai/jskit-cli/src/server/core/usageHelp.js` → `printTopLevelHelp()`
- `npx jskit help <command>` is the canonical usage entrypoint.

## 2) command catalog + alias map
- `commandCatalog.js` known commands:
  - `help`
  - `create`
  - `generate`
  - `list`
  - `list-placements`
  - `list-link-items`
  - `show`
  - `view`
  - `migrations`
  - `add`
  - `position`
  - `update`
  - `remove`
  - `doctor`
  - `lint-descriptors`
- Alias map in current runtime:
  - `view -> show`
  - `ls -> list`
  - `gen -> generate`
  - `lp -> list-placements`
  - `lpct -> list-link-items`
  - `list-placement-component-tokens -> list-link-items`
- `dispatchCli` resolves alias before command dispatch.

## 3) argv parser contract
- Parser file: `node_modules/@jskit-ai/jskit-cli/src/server/core/argParser.js`
- Leading `--help` / `-h` as first token converts command to `help` and prints usage.
- For normal commands, unknown command names fail `Unknown command: ${raw}` with showUsage.
- Default options object keys:
  - `dryRun`, `runNpmInstall`, `full`, `expanded`, `details`, `debugExports`, `checkDiLabels`, `verbose`, `json`, `all`, `help`, `inlineOptions`
- Recognized global flags:
  - `--dry-run`
  - `--run-npm-install`
  - `--full`
  - `--expanded`
  - `--details`
  - `--debug-exports`
  - `--check-di-labels`
  - `--verbose`
  - `--json`
  - `--all`
  - `--help` / `-h`
- Special parser behavior:
  - `--force` parsed as inline option with value string `true`.
  - All `--foo value` and `--foo=value` forms supported.
  - Unknown `-x`/`-abc` (single dash) => unknown option.
- Generate inline-option parsing is looser than other commands:
  - command is `generate`
  - option names regex: `^[A-Za-z][A-Za-z0-9_-]*$` (note case+underscore allowed)
  - `--<option> <value>` may be optional-ish for generator subcommands.
- Non-generate commands expect strict lowercase dashed names: `^[a-z][a-z0-9-]*$` and require value.

## 4) dispatch pipeline
- Runner chain:
  - `src/server/cliEntrypoint.js` -> `runCliEntrypoint()` -> `runCli()` (`@jskit-ai/jskit-cli/src/server/core/createCliRunner.js`)
  - `parseArgs`
  - `runCli` checks:
    - `options.help` or command `help` => `printUsage()` and exit 0
    - `shouldShowCommandHelpOnBareInvocation(command, positional)` for certain commands => help and exit 0
  - command handler dispatch switch (`create/list/list-placements/list-link-items/show/migrations/add/generate/position/update/remove/doctor/lint-descriptors`)
  - catches errors, prints `jskit: ${message}`, prints usage if `error.showUsage`
  - finally `cleanupMaterializedPackageRoots()` always executes

## 5) help-driven command contracts (canonical from usageHelp.js)
### create
- Minimal: `jskit create package <name>`
- Parameters: `<name>` = local package slug -> `packages/<name>`
- Defaults:
  - no npm install unless `--run-npm-install`
  - `--scope` inferred from app name
  - `--package-id` derived from scope+name if omitted
- Full: `jskit create package <name> [--scope <scope>] [--package-id <id>] [--description <text>] [--dry-run] [--run-npm-install] [--json]`

### add
- Minimal: `jskit add package <packageId>`
- Parameters:
  - target type: `package | bundle`
  - `<packageId|bundleId>`
- Defaults:
  - no npm install unless `--run-npm-install`
  - short ids resolve to `@jskit-ai/<id>`
  - running without args lists bundles+runtime packages
  - existing matching version skipped unless options force reapply
- Full: `jskit add <package|bundle> <id> [--<option> <value>...] [--dry-run] [--run-npm-install] [--json] [--verbose]`

### generate
- Minimal: `jskit generate <generatorId>`
- Parameters:
  - `<generatorId>`
  - optional `[subcommand]`
  - optional `[subcommand args...]`
- Defaults:
  - no npm install unless `--run-npm-install`
  - short ids resolve to `@jskit-ai/<id>`
  - no args -> list generators
  - only `<generatorId>` -> generator help
  - `generate <generatorId> <subcommand> help` for subcommand usage
- Full: `jskit generate <generatorId> [subcommand] [subcommand args...] [--<option> <value>...] [--dry-run] [--run-npm-install] [--json] [--verbose]`

### list
- Minimal: `jskit list`
- Parameter `[mode]` where mode in `{bundles, packages, generators}`
- Defaults:
  - without mode: bundles + runtime packages + generators
  - placements are in `list-placements`
  - `--full` and `--expanded` affect bundle/package views
- Full: `jskit list [bundles|packages|generators] [--full] [--expanded] [--json]`

### list-placements
- Minimal: `jskit list-placements`
- Full: `jskit list-placements [--json]`
- Defaults indicate discovery from Vue `ShellOutlet` tags + route meta + installed package metadata.

### list-link-items
- Minimal: `jskit list-link-items`
- Parameters:
  - `[--prefix <value>]` optional token prefix filter
  - `[--all]` include all discovered tokens
- Defaults:
  - defaults to tokens ending in `link-item`
  - includes app + installed-package sources
  - `--prefix` to narrow (example `local.main.`)
- Full: `jskit list-link-items [--prefix <value>] [--all] [--json]`

### show
- Minimal: `jskit show <id>`
- Defaults:
  - `view` is alias of `show`
  - details output enabled by `--details`
  - `--debug-exports` implies details
- Full: `jskit show <id> [--details] [--debug-exports] [--json]`

### migrations
- Minimal: `jskit migrations changed`
- Parameters: `<scope> in {all|changed|package}` and optional `[packageId]` only for package scope
- Defaults:
  - no npm install unless `--run-npm-install`
  - inline options only for `migrations package <packageId>`
  - plain text lists touched migration files unless `--json`
- Full: `jskit migrations <all|changed|package> [packageId] [--<option> <value>...] [--dry-run] [--json] [--verbose]`

### position
- Minimal: `jskit position element <packageId>`
- Defaults:
  - only positioning mutations applied
  - no npm install unless `--run-npm-install`
  - reads current lock options unless overridden inline
- Full: `jskit position element <packageId> [--<option> <value>...] [--dry-run] [--json]`

### update
- Minimal: `jskit update package <packageId>`
- Defaults:
  - no npm install unless `--run-npm-install`
  - lock options reused unless overridden inline
  - update is add-flow with forced reapply
- Full: `jskit update package <packageId> [--<option> <value>...] [--dry-run] [--run-npm-install] [--json]`

### remove
- Minimal: `jskit remove package <packageId>`
- Defaults:
  - no npm install unless `--run-npm-install`
  - managed files and lock entries removed
  - local package source dirs not deleted
- Full: `jskit remove package <packageId> [--dry-run] [--run-npm-install] [--json]`

### doctor
- Minimal: `jskit doctor`
- Defaults:
  - validates lock entries, managed files, registry visibility
  - plain text default
  - machine diagnostics with `--json`
- Full: `jskit doctor [--json]`

### lint-descriptors
- Minimal: `jskit lint-descriptors`
- Defaults:
  - runs descriptor consistency checks
  - optional stricter DI checks with `--check-di-labels`
  - plain text default, `--json` supported
- Full: `jskit lint-descriptors [--check-di-labels] [--json]`

## 6) bare-invocation help behavior
- `BARE_COMMAND_HELP` set for commands: `create`, `show`, `migrations`, `position`, `update`, `remove`
- If positional count < 1 for these commands -> help shown automatically.

## 7) package lifecycle internals (unchanged from prior snapshot, re-grounded to current)
- `create/run` path in `node_modules/@jskit-ai/jskit-cli/src/server/core/createCommandHandlers.js` with implementation in `src/server/commandHandlers` and `cliRuntime`.
- `add`/`generate` share installation graph + option validation + mutation application.
- `generate` wraps add flow with `commandMode = "generate"` and validates generator kind.
- `update` passes forced reapply semantics into add flow.
- `position` replays positioning mutations only.
- `remove` uses lock dependency graph and refuses deleting dependency-broken removals.
- Migrations and lock updates still use `migrationSyncVersion` and managed mutation records.

## 8) actionable delta since previous cheat-sheet version
- replace implicit auto-install with explicit `--run-npm-install` semantics everywhere.
- top-level command list changed wording/order and removed legacy examples.
- added alias `list-placement-component-tokens -> list-link-items`.
- global flags now only `dry-run/run-npm-install/json/verbose/help`.
- command help text is now authoritative in `usageHelp.js` and should be treated as source-of-truth.

## 9) ui-generator deep internals (empirically verified)
- `npx jskit generate ui-generator <subcommand> <args...>` dispatches through the same generator handler path as other generators; `help` is always `npx jskit generate ui-generator <subcommand> help`.
- Current generator subcommands in this repo snapshot:
  - `page`
  - `outlet`
  - `add-subpages`
  - `placed-element`
  - (`element` is invalid here; use `placed-element`).
- Global generator parsing is tolerant on option shape (`--force`, `--force true`, etc.) but runtime behavior can still enforce required fields.
- `page` and `add-subpages` both honor `--dry-run`, `--run-npm-install`, `--json`, `--verbose`.

## 10) `add-subpages`: what it does (not just syntax)
Example used:
```bash
npx jskit generate ui-generator add-subpages \
  admin/contacts/[contactId]/index.vue \
  --target contact-view:summary-tabs \
  --path src/components/admin \
  --title "Contact" \
  --subtitle "Manage contact modules."
```
- Command-level intent:
  - Convert a plain page into a subpages host.
  - Register a placement host position pair (`contact-view:summary-tabs`) derived from route context.
  - Install tab shell + tab-link component scaffold under the `--path` component folder.
  - Make child pages render under that shell automatically.
- Observed file mutations (from dry-run + actual run):
  - `packages/main/src/client/providers/MainClientProvider.js`:
    - adds/adjusts `local.main.ui.tab-link-item` registration wiring for `TabLinkItem`.
  - `src/components/admin/SectionContainerShell.vue`:
    - scaffolded shell component with title/subtitle and default `tabs` + `default` slots.
  - `src/components/admin/TabLinkItem.vue`:
    - scaffolded router-link style tab entry component.
  - `src/pages/w/[workspaceSlug]/admin/contacts/[contactId]/index.vue` (target page path was relative to project root and prefixed by workspace slug when invoked from a route root):
    - wrapped existing template in `<SectionContainerShell title="Contact" subtitle="Manage contact modules.">`.
    - inserted `<ShellOutlet host="contact-view" position="summary-tabs" />`.
    - inserted `<RouterView />` so children mount under host.
- Semantics of `--path`:
  - It is a workspace-relative path (e.g. `src/components/admin`), not a filesystem absolute path.
- Idempotency:
  - Running the same `add-subpages` command again returns:
    - `Subpages are already enabled.`
    - no structural rewrites.

## 11) child pages + host inference (hard parts)
- Generator used for child creation:
```bash
npx jskit generate ui-generator page \
  "w/[workspaceSlug]/admin/contacts/[contactId]/index/notes/index.vue" \
  --name "Notes" \
  --run-npm-install
```
- This generated the child file and placement metadata without requiring explicit host flags.
- Inferred behavior confirmed:
  - target parent = nearest ancestor host page (`.../index.vue` with enabled subpages).
  - host/position inferred from nearest parent `ShellOutlet` (`contact-view:summary-tabs`).
  - route context inferred relative to parent:
    - `props.to` was generated as `./notes`.
    - page registration added under `src/placement.js` with `ui-generator.page.admin.contacts.contact-id.notes.link`.
  - `surface` was set to `["admin"]` for placement.
  - workspace/non-workspace suffixes were generated from actual path (`.../contacts/[contactId]/notes`).
- Observable placement entry fields (from `src/placement.js`):
  - `host: "contact-view"`
  - `position: "summary-tabs"`
  - `componentToken: "local.main.ui.tab-link-item"`
  - `props.to`
  - `label` (from `--name`)
- Re-run check:
  - `npx jskit list-placements --json` now includes the inferred placement chain with host `contact-view`.
  - `npx jskit list-link-items --json` includes token `local.main.ui.tab-link-item` once scaffolds are present.

## 12) `add-subpages`/child link generation contract captured from behavior
- "Host is implicit" pattern:
  - `add-subpages` creates explicit host metadata.
  - `page` inherits host context from nearest configured host page.
- Child page rule:
  - child paths must be under `index/.../index.vue` for them to be attached to the nearest host.
- Naming rule:
  - page name labels and route labels are not auto-extracted from filename unless generator provides defaults from `--name`.
- Force/update nuance:
  - `--force` affects overwrite behavior when existing outputs are present.
  - Without force, existing file exists => command emits existing-file status and skips replacing unless no-op path is safe.

## 13) quick answer bank for prior user questions
- `--path` question:
  - it is not an absolute path requirement in this runtime; `src/components/admin` works as expected.
- `list-commands evidence after enablement`:
  - `list-placements` reflects `contact-view:summary-tabs`.
  - `list-link-items` reflects `local.main.ui.tab-link-item`.
- "What does this do" (single-line summary):
  - It turns the given page into a tabbed host, creates a reusable shell and tab component, registers link token wiring, and enables child page injection into that slot through placements.

## 14) evidence-first transcripts (no `--dry-run`)
- This repository now contains only non-dry-run evidence from live commands.

### A) path validation on `add-subpages`
```bash
npx jskit generate ui-generator add-subpages "admin/contacts/[contactId]/index.vue" --target contact-view:summary-tabs --path src/components/admin --title "Contact" --subtitle "Manage contact modules."
```
Observed output:
```text
jskit: ui-generator add-subpages target file must be relative to src/pages/ and resolve to a configured surface: admin/contacts/[contactId]/index.vue.
```

### B) idempotent host enablement requires exact target path
```bash
npx jskit generate ui-generator add-subpages "w/[workspaceSlug]/admin/contacts/[contactId]/index.vue" --target contact-view:summary-tabs --path src/components/admin --title "Contact" --subtitle "Manage contact modules."
```
Observed output:
```text
jskit: ui-generator add-subpages found existing RouterView in src/pages/w/[workspaceSlug]/admin/contacts/[contactId]/index.vue. Subpages are already enabled.
```
Runtime effect: command exits non-zero (1) with explicit no-op status message.

### C) child page creation under configured host
```bash
npx jskit generate ui-generator page "w/[workspaceSlug]/admin/contacts/[contactId]/index/activity/index.vue" --name "Activity"
```
Observed output:
```text
Generated with @jskit-ai/ui-generator (page).
Generated UI page "/contacts/[contactId]/activity" at src/pages/w/[workspaceSlug]/admin/contacts/[contactId]/index/activity/index.vue.
Touched files (2):
- src/pages/w/[workspaceSlug]/admin/contacts/[contactId]/index/activity/index.vue
- src/placement.js
```

### D) placement registry snapshot after live run (`--json`)
`npx jskit list-placements --json` includes:
```json
{
  "id": "contact-view:summary-tabs",
  "host": "contact-view",
  "position": "summary-tabs",
  "sourcePath": "src/pages/w/[workspaceSlug]/admin/contacts/[contactId]/index.vue"
}
```
`jskit list-link-items --json` includes:
```json
{
  "token": "local.main.ui.tab-link-item",
  "sources": [
    "app:packages/main/src/client/providers/MainClientProvider.js",
    "app:src/placement.js"
  ]
}
```

### E) generated page and placement artifacts (verbatim snippets)
- Generated child page scaffold:
```vue
<template>
  <section class="pa-4">
    <h1 class="text-h5 mb-2">Activity</h1>
    <p class="text-body-2 text-medium-emphasis">Replace this scaffold with your page implementation.</p>
  </section>
</template>
```
- Host page now wraps content in shell + outlet:
```vue
<SectionContainerShell title="Contact" subtitle="Manage contact modules.">
  <template #tabs>
    <ShellOutlet host="contact-view" position="summary-tabs" />
  </template>

    <main>
      <h1>Contact detail</h1>
    </main>

  <RouterView />
</SectionContainerShell>
```
- Placement append for child in `src/placement.js`:
```js
// jskit:ui-generator.page.link:admin:/contacts/[contactId]/activity
{
  addPlacement({
    id: "ui-generator.page.admin.contacts.contact-id.activity.link",
    host: "contact-view",
    position: "summary-tabs",
    surfaces: ["admin"],
    componentToken: "local.main.ui.tab-link-item",
    props: {
      label: "Activity",
      surface: "admin",
      workspaceSuffix: "/contacts/[contactId]/activity",
      nonWorkspaceSuffix: "/contacts/[contactId]/activity",
      to: "./activity",
    },
    when: ({ auth }) => Boolean(auth?.authenticated)
  });
}
```

### F) inferred behavior confirmed by this evidence set
- `--target` and shell metadata are scoped by route-contexted host page when subpages are already enabled.
- Host path in `add-subpages` must resolve to a configured page surface under `src/pages/`.
- Child route generation can infer host/position and emits `placement.js` entries with:
  - `to: "./<child>"` relative links from parent host page location.
  - stable id format `ui-generator.page.<route-segments>.link` with bracket params normalized (`[contactId]` -> `contact-id`).
  - same `surface` and `componentToken` contract as host's configured host.

## 15) extended matrix (all high-signal combinations captured)

### 15.1 add-subpages matrix
- `target-file` required shape:
  - relative to `src/pages/` without `src/pages/` prefix and without leading `src/`.
  - must resolve to configured surface.
- accepted format examples:
  - ok: `w/[workspaceSlug]/admin/contacts/[contactId]/index.vue`
  - fail (prefix): `admin/...` and `src/pages/...`.
- `--target` contract:
  - host-only: `contact-view` => `contact-view:sub-pages`.
  - host:position: `contact-view:summary-tabs`.
  - invalid format: `badhost:` => `"must be \"host\" or \"host:position\"."`.
- `--path` is app-relative scaffold path; no absolute path requirement.
- `--title/--subtitle` only affect generated host shell attrs.
- `--force` is intentionally unsupported for this subcommand.
- output semantics:
  - configured file + existing `<RouterView>` => `Subpages are already enabled.` with non-zero exit.
  - first-run with valid target => wraps page in SectionContainerShell + tabs + RouterView and writes scaffold support.

#### exact runs I captured
- `npx jskit generate ui-generator add-subpages "admin/contacts/[contactId]/index.vue" --target contact-view:summary-tabs ...`
  - output: `target file must be relative to src/pages/ and resolve to a configured surface`.
- `npx jskit generate ui-generator add-subpages "w/[workspaceSlug]/admin/contacts/[contactId]/index.vue" --target badhost:`
  - output: `option "target" must be "host" or "host:position".`
- `npx jskit generate ui-generator add-subpages "w/[workspaceSlug]/admin/contacts/[contactId]/index.vue" --force`
  - output includes help and `Unknown option ... --force`.
- `npx jskit generate ui-generator add-subpages "w/[workspaceSlug]/admin/customers/[customerId]/index.vue" --path src/components/admin --title "Customer"`
  - output: `Enabled subpages ... using outlet target "customers-customer-id:sub-pages"`.

### 15.2 page matrix
- required positional:
  - required: one `target-file` positional arg only.
- overwrite:
  - no overwrite without `--force` when file exists.
  - `--force` overwrites file and returns `Regenerated ...` when target existed.
- inference:
  - nearest parent host search prefers a single upstream host outlet.
  - if parent and child are index-route nested, `props.to` derives `./<child>`.
  - if no resolvable single parent, falls back to default placement target.
- defaults:
  - if no `--name`, label derived from route segment.
  - if no explicit `--link-placement`, uses inferred host if found.
  - if no explicit `--link-component-token`, uses:
    - subpage default for inferred host = `local.main.ui.tab-link-item`.
    - general default if not inferred = `local.main.ui.surface-aware-menu-link-item`.

#### exact runs I captured
- `npx jskit generate ui-generator page "w/[workspaceSlug]/admin/contacts/[contactId]/index/activity/index.vue" --name "Activity"`
  - output: overwrite error because file exists.
- same path + `--force`
  - output: `Regenerated UI page "/contacts/[contactId]/activity" ...`.
- no `--name`:
  - `npx ... page ".../index/task/index.vue"`
  - output scaffold heading is `Task` and placement label `Task`.
- explicit link override:
  - `npx ... page ".../index/letters/index.vue" --name "Letters" --link-placement shell-layout:primary-menu --link-component-token local.main.ui.surface-aware-menu-link-item --link-to "/contacts/letters"`.
  - placement ended on `host: "shell-layout", position: "primary-menu"`, token override, explicit to.
- bad placement format:
  - `... --link-placement bad` -> `"must be in \"host:position\" format."`.
- unknown placement:
  - `... --link-placement bad:placement` -> not declared list error.
- token override not validated:
  - `--link-component-token local.main.ui.missing-token` accepted and written.

### 15.3 outlet matrix
- required positional:
  - required existing Vue SFC file relative to app root.
- required option:
  - required `--target`.
- target contract:
  - same `host`/`host:position` parsing as add-subpages.
  - host-only => sub-pages.
- insertion behavior:
  - adds `<ShellOutlet ... />` inside existing template close by default; creates template when absent.
  - injects `import ShellOutlet` in script/setup if missing.

#### exact runs I captured
- no-op detection:
  - `... outlet src/pages/.../contacts/[contactId]/index.vue --target contact-view:summary-tabs`
  - output `Outlet ... is already present`, `Touched files (0)`.
- first-time insertion:
  - `... outlet .../index/letters/index.vue --target shell-layout`
  - output `Injected outlet "shell-layout:sub-pages" ...`.
- bad host value:
  - `... --target badplacement` (or no colon format) => format error.
- placement not declared:
  - `... --target impossible:slot` => `option "placement" target ... is not declared ...`.
- unknown option:
  - `... --bogus` => unknown-option + help.

### 15.4 placed-element matrix
- required:
  - `--name` and `--surface` required.
- optional:
  - `--path` (default `src/components`), `--placement` (default `shell-layout:top-right`), `--force`.
- derived outputs:
  - file name = `<PascalCase(name)>Element.vue`.
  - token = `local.main.ui.element.<kebab-name>`.
  - component marker key `jskit:ui-generator.element:<surface>:<kebab>`.
- placement target resolution:
  - requires requested target to exist in app or installed package declarations.

#### exact runs I captured
- `npx ... placed-element --name "Ops Panel" --surface admin --path src/widgets --placement contact-view:summary-tabs`
  - touches provider, placement, component and emits token `local.main.ui.element.ops-panel`.
- repeat same command:
  - overwrite error on existing component.
- same + `--force` with unchanged content:
  - `Placed UI element "ops-panel" is already up to date.`
- invalid surface:
  - missing `--surface` => explicit `requires --surface`.
- invalid option:
  - `--bogus` => unknown-option + help.
- invalid placement:
  - `--placement impossible:slot` => `option "placement" target ... is not declared ... Available targets: ...`.

### 15.5 list-* command matrix
- `list-placements`:
  - default/non-json and json both work.
  - shows discovered placements with host/position/source and default marker.
- `list-link-items` default:
  - filters to link-like tokens only.
- `list-link-items --all`:
  - includes non-link tokens (e.g., `local.main.ui.element.ops-panel` once placed-elements are generated).
- `list-link-items --prefix local.main --all`:
  - returns local scoped tokens, including non-link-item entries when `--all` is set.

### 15.6 critical gotchas worth encoding in automation
- Host inference requires ancestor host page to expose exactly one outlet target.
  - If host page has multiple `ShellOutlet` targets, nearest parent inference can fail, causing fallback to app default placement.
  - Observed: adding `shell-layout:sub-pages` to contact host made `page` child `shift` use `shell-layout:primary-menu`; explicit `--link-placement` fixed it.
- Provider registration contract is hard-checked in `add-subpages` and `placed-element`; missing `registerMainClientComponent` aborts.
- `outlet` changes are discoverable by `list-placements` and become valid destinations for future page/element generation.

## 16) additional evidence: full-surface behavior matrix and caveats

### 16.0 invocation routing rules (critical)
- Top-level discovery commands:
  - `npx jskit list-placements` ✅
  - `npx jskit list-link-items` ✅
- Generator-local list-commands under `generate` are not valid here:
  - `npx jskit generate ui-generator list-placements` ❌
  - `npx jskit generate ui-generator list-link-items` ❌
- Generator subcommand help path:
  - `npx jskit generate ui-generator <subcommand> help`
- Error shapes:
  - `Unknown command` for bad top-level commands.
  - `Unknown generator usage` when generator argument points to invalid shape.

### 16.1 add-subpages matrix (expanded)
- `--target` contract:
  - accepts `host` or `host:position`.
  - host-only means position defaults to `sub-pages`.
- `target-file` rules:
  - must resolve relative to `src/pages`.
  - must resolve to a configured surface path.
- `--target` is optional:
  - when omitted and page is valid, target is inferred from route.
- `--path` defaults `src/components`.
- `--force` is unsupported.

Observed:
- `npx jskit generate ui-generator add-subpages "w/[workspaceSlug]/admin/assistant/index.vue" --title Assistant --subtitle "Assistants"`
  - output: `Enabled subpages ... using outlet target "assistant:sub-pages"`.
- `npx jskit generate ui-generator add-subpages "admin/contacts/[contactId]/index.vue" --target contact-view:summary-tabs ...`
  - output: `target file must be relative to src/pages/ ...`
- `... --target badhost:`
  - output: `option "target" must be "host" or "host:position".`
- `... --target nohost:sub-pages` on first-time host file:
  - output succeeds and creates `host:sub-pages` placement entry even if host was not pre-existing.
  - `npx jskit list-placements --json` then includes that host.
- `... --target nope:sub-pages` on an already enabled host still short-circuits:
  - output: `Subpages are already enabled`.
- repeated invocation on enabled host returns no-op and exit non-zero.

### 16.2 page matrix (deeper inference coverage)
- Always generates a page scaffold.
- Overwrite behavior:
  - without `--force`, existing page blocks run.
  - with `--force`, page and placement regenerate.
- `to` inference:
  - child under host index defaults to `./child`.
  - explicit `--link-to` is preserved exactly (relative or absolute).
- Inferred host and token path:
  - if nearest parent host has exactly one subpages outlet, host/position/token are inferred.
  - if parent cannot be cleanly resolved, placement falls back to default host/position behavior.
- Token override:
  - `--link-component-token` does not validate token existence.
- Placement override:
  - `--link-placement` must be `host:position` and must exist.

Observed:
- `npx jskit generate ui-generator page "w/[workspaceSlug]/admin/customers/[customerId]/index/notes/index.vue" --name Notes --link-component-token local.main.ui.surface-aware-menu-link-item`
  - writes placement with explicit token.
- `npx jskit generate ui-generator page ".../index/finance/index.vue" --name Finance --link-placement shell-layout:sub-pages --force`
  - writes `host: "shell-layout", position: "sub-pages"`.
- `npx jskit generate ui-generator page ".../index/sla/index.vue" --name SLA --link-to "/customers/sla-dashboard"`
  - writes `props.to: "/customers/sla-dashboard"`.
- `npx jskit generate ui-generator page ".../index/terms/index.vue" --name Terms --link-placement shell-layout:secondary-menu --link-to "./terms"`
  - writes explicit placement.
- `npx jskit generate ui-generator page ".../index/notes2/index.vue" --name Notes2 --link-component-token local.main.ui.missing-token`
  - writes missing token placement.
- `npx jskit generate ui-generator page ".../index/new/notes/index.vue" --name NewChild`
  - child under `/admin/contacts/new` inferred host became `nope:sub-pages` from earlier add-subpages run.
- invalid placement inputs:
  - `... --link-placement shell-layout` => `must be in "host:position" format.`
  - `... --link-placement impossible:slot` after a host exists => undeclared target error.
  - malformed input can create file then fail later if placement is invalid (observed: first no-colon format produced scaffold; follow-up `--force` + invalid target rejected with explicit declared-target list).

### 16.3 outlet matrix (newly observed edge cases)
- `--target` is mandatory and accepts host/host:position.
- Insertion semantics:
  - adds `import ShellOutlet` for SFCs when missing.
  - injects `<ShellOutlet host="..." position="..." />` near template end/appropriate slot.
- No-op semantics:
  - already-present outlet => `Touched files (0)`.

Observed:
- `npx jskit generate ui-generator outlet src/pages/w/[workspaceSlug]/admin/assistant/index.vue --target assistant`
  - first: injects. second: no-op.
- `npx jskit generate ui-generator outlet src/components/admin/SectionContainerShell.vue --target shell-layout:top-left`
  - first injects, second no-op.
- `npx jskit generate ui-generator outlet src/components/admin/SectionContainerShell.vue --target shell-layout:top-right`
  - injects additional outlet.
- `npx jskit generate ui-generator outlet src/components/ShellLayout.vue --target shell-layout`
  - injected `shell-layout:sub-pages`.
- `npx jskit generate ui-generator outlet src/pages/w/[workspaceSlug]/admin/practice/vets/_components/VetAddEditFormFields.js --target shell-layout`
  - output says injected, but this file is JS; check resulting file for corruption risk.

### 16.4 placed-element matrix
- Required:
  - `--name` and `--surface`.
- Optional defaults:
  - `--path` → `src/components`
  - `--placement` → `shell-layout:top-right` when omitted.
- Required validation:
  - unknown surface is rejected.
  - unknown explicit placement is rejected.
- Outputs:
  - `<PascalName>Element.vue`
  - component token `local.main.ui.element.<kebab-name>`
  - provider registration via `registerMainClientComponent`.

Observed:
- `npx jskit generate ui-generator placed-element --name "Billing Panel" --surface admin --placement shell-layout:top-right`
  - wrote provider, component, placement.
- second run same command => overwrite blocked until `--force`.
- second with `--force` unchanged => `is already up to date`.

### 16.5 list-* caveats
- `jskit list-placements --json --prefix nope` still returned all placements in this repo; prefix filtering appears non-functional for placements.
- `jskit list-link-items --all --prefix local.main.ui` filters correctly.
- `jskit list-link-items --all --prefix does-not-exist` returns `- none`.
- `jskit list-link-items` default output still filters to link-item suffix only.

### 16.6 non-obvious coupling and generated artifacts
- `add-subpages` writes directly into page file only for host enablement; it does not inject top-level page placement entries.
- `placed-element` and `page` use discovered placement targets from list state, so ordering of command runs changes what is valid as a target.
- Host inference can be brittle with non-unique child outlets and can force fallback/default placement; explicit `--link-placement` is the deterministic fix.
- Placement IDs are canonicalized; dynamic route params collapse brackets: `[customerId]` => `customer-id`.
- `to` defaults are inferred only for `page`; explicit override always wins.
