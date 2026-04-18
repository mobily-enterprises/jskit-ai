# 001 UI Generator

Use these commands when you want to:

- create a page at a specific location
- turn a page into a host for child routes
- generate a CRUD route tree
- install assistant runtime/config and then create assistant pages

All examples below use the short generator ids such as `ui-generator`. The full ids such as `@jskit-ai/ui-generator` also work.

## Quick Start

List known placements in the current app:

```bash
npx jskit list placements
```

Inspect generator help:

```bash
npx jskit generate ui-generator help
npx jskit generate ui-generator page help
npx jskit generate ui-generator add-subpages help
npx jskit generate ui-generator placed-element help
npx jskit generate ui-generator outlet help

npx jskit generate crud-ui-generator crud help

npx jskit generate assistant setup help
npx jskit generate assistant page help
npx jskit generate assistant settings-page help
```

## Start Here

The normal workflow is:

1. Decide the exact page file or CRUD route root you want.
2. Generate it at that location.
3. If that page should host child routes, run `add-subpages` on it.
4. Create child pages under the correct folder shape.
5. Only use placement overrides when the defaults are not what you want.

## Choose The Page Shape

You can build the same route either as a file route or as an index route.

Examples:

- `src/pages/admin/reports.vue` -> `/reports`
- `src/pages/admin/reports/index.vue` -> `/reports`
- `src/pages/admin/customers/[customerId].vue` -> `/customers/[customerId]`
- `src/pages/admin/customers/[customerId]/index.vue` -> `/customers/[customerId]`

Both shapes are valid. What matters is where child pages live.

## Child Pages

If the parent is a file route:

- parent: `src/pages/admin/customers/[customerId].vue`
- child: `src/pages/admin/customers/[customerId]/notes/index.vue`
- route: `/customers/[customerId]/notes`

If the parent is an index route:

- parent: `src/pages/admin/customers/[customerId]/index.vue`
- child: `src/pages/admin/customers/[customerId]/index/notes/index.vue`
- route: `/customers/[customerId]/notes`

That `index/...` folder shape is the native nesting rule for children of `index.vue`.

## Most Common Recipes

Create a plain page:

```bash
npx jskit generate ui-generator page \
  src/pages/admin/reports/index.vue
```

Turn a page into a subpages host:

```bash
npx jskit generate ui-generator add-subpages \
  src/pages/admin/customers/[customerId]/index.vue \
  --title "Customer" \
  --subtitle "View and manage this customer."
```

Add a child page under that index-route host:

```bash
npx jskit generate ui-generator page \
  src/pages/admin/customers/[customerId]/index/notes/index.vue \
  --name "Notes"
```

Create a CRUD route tree:

```bash
npx jskit generate crud-ui-generator crud \
  src/pages/admin/catalog/index/products \
  --resource-file packages/products/src/shared/productResource.js
```

Install assistant runtime/config and then add pages:

```bash
npx jskit generate assistant setup \
  --surface admin \
  --settings-surface admin \
  --config-scope workspace \
  --ai-provider openai \
  --ai-api-key "$OPENAI_API_KEY" \
  --ai-base-url "" \
  --ai-timeout-ms 120000

npx jskit generate assistant page \
  src/pages/admin/assistant/index.vue

npx jskit generate assistant settings-page \
  src/pages/admin/settings/index/assistant/index.vue \
  --surface admin
```

## UI Generator

### What it does

`ui-generator` handles four jobs:

- `page`: create a page and its default link placement
- `add-subpages`: turn an existing page into a routed child-page host
- `placed-element`: scaffold a reusable placed UI component
- `outlet`: inject a plain `ShellOutlet` into an existing Vue file

### Basic commands

Create an index-route page:

```bash
npx jskit generate ui-generator page \
  src/pages/admin/catalog/index.vue \
  --name "Catalog"
```

Create a file-route page:

```bash
npx jskit generate ui-generator page \
  src/pages/admin/contacts/[contactId].vue \
  --name "Contact"
```

Upgrade a page into a routed subpages host:

```bash
npx jskit generate ui-generator add-subpages \
  src/pages/admin/contacts/[contactId]/index.vue \
  --title "Contact" \
  --subtitle "View and manage this contact."
```

Create a child page under an index-route host:

```bash
npx jskit generate ui-generator page \
  src/pages/admin/contacts/[contactId]/index/notes/index.vue \
  --name "Notes"
```

Create a child page under a file-route host:

```bash
npx jskit generate ui-generator page \
  src/pages/admin/customers/[customerId]/pets/index.vue \
  --name "Pets"
```

Create a reusable placed element:

```bash
npx jskit generate ui-generator placed-element \
  --name "Alerts Widget" \
  --surface admin \
  --placement shell-layout:top-right
```

Inject a plain generic outlet:

```bash
npx jskit generate ui-generator outlet \
  src/components/ContactSummaryCard.vue \
  --host contact-view \
  --position summary-actions
```

### What `add-subpages` adds

`add-subpages` upgrades an existing page into the stock routed host shape:

- `SectionContainerShell`
- `ShellOutlet host="..." position="sub-pages"`
- `RouterView`

It also ensures the shared support scaffold exists:

- `src/components/SectionContainerShell.vue`
- `src/components/TabLinkItem.vue`
- `local.main.ui.tab-link-item` registration in the app provider

Use `add-subpages` when the page should show shared content plus routed children below it.

Use `outlet` only when you want to add a plain outlet block and nothing else.

### Placement inference

When you create a page with `ui-generator page`:

- if a parent subpages host is found, the new page is placed under that host
- the default renderer becomes `local.main.ui.tab-link-item`
- `props.to` is inferred from the child route, such as `./notes`
- otherwise the page falls back to the app shell default placement target

### `page` options

Required:

- `<target-file>`

Optional:

- `--name`
- `--link-placement`
- `--link-component-token`
- `--link-to`

Example with explicit override:

```bash
npx jskit generate ui-generator page \
  src/pages/admin/reports/index.vue \
  --name "Reports" \
  --link-placement shell-layout:top-right
```

### `add-subpages` options

Required:

- `<target-file>`

Optional:

- `--target`
- `--path`
- `--title`
- `--subtitle`

`--target` accepts either:

- `host`
- `host:position`

Examples:

- `--target catalog` means `catalog:sub-pages`
- `--target catalog:secondary-tabs` uses a custom position

### `placed-element` options

Required:

- `--name`
- `--surface`

Optional:

- `--path`
- `--placement`

### `outlet` options

Required:

- `<target-file>`
- `--host`

Optional:

- `--position`

`outlet` only injects:

- `import ShellOutlet ...`
- `<ShellOutlet host="..." position="..." />`

It does not add:

- `RouterView`
- `SectionContainerShell`
- routed child-page scaffolding

## CRUD UI Generator

### The command shape

CRUD generation is now route-root driven:

```bash
npx jskit generate crud-ui-generator crud <target-root> --resource-file <resource-file>
```

`<target-root>` is the real route root under `src/pages/...`.

Example:

```bash
npx jskit generate crud-ui-generator crud \
  src/pages/admin/catalog/index/products \
  --resource-file packages/products/src/shared/productResource.js
```

That generates:

- `src/pages/admin/catalog/index/products/index.vue`
- `src/pages/admin/catalog/index/products/[recordId]/index.vue`
- `src/pages/admin/catalog/index/products/new.vue`
- `src/pages/admin/catalog/index/products/[recordId]/edit.vue`
- `src/pages/admin/catalog/index/products/_components/...`

### Nested CRUD under a record host

If the parent host is an index route:

```bash
npx jskit generate ui-generator add-subpages \
  src/pages/admin/customers/[customerId]/index.vue \
  --title "Customer" \
  --subtitle "View and manage this customer."

npx jskit generate crud-ui-generator crud \
  src/pages/admin/customers/[customerId]/index/pets \
  --resource-file packages/pets/src/shared/petResource.js \
  --id-param petId
```

That yields `/customers/[customerId]/pets` as a child route of the customer page.

### CRUD defaults

Required:

- `<target-root>`
- `--resource-file`

Defaults:

- `--operations` defaults to `list,view,new,edit`
- `--id-param` defaults to `recordId`
- `--namespace` is derived from the resource when possible
- the generated list-page link follows the same parent-host inference as `ui-generator page`

If you want the detailed behavior for how the list page attaches to a parent host, read the `ui-generator page` explanation in the earlier `Placement inference` section, or run:

```bash
npx jskit generate ui-generator page help
```

Optional:

- `--operations`
- `--display-fields`
- `--id-param`
- `--link-placement`
- `--namespace`

The older path-synthesis options are gone. You do not pass `surface`, `route-path`, `directory-prefix`, `container`, `link-to`, or `link-component-token` for normal CRUD generation anymore.

## Assistant

Assistant has one required install step and up to two optional page steps:

- `setup`: required. Installs the assistant runtime/config into the app.
- `page`: optional. Creates the assistant runtime page.
- `settings-page`: optional. Creates an assistant settings page.

There is no separate server step and no separate client step.

`setup` is the install step.

Under the hood, the packages are layered like this:

- `assistant`: the generator package. It provides `setup`, `page`, and `settings-page`.
- `assistant-runtime`: the app runtime package installed by `setup`. It wires routes, services, repositories, provider registration, config, and migrations into the app.
- `assistant-core`: the lower-level library package pulled in by `assistant-runtime`. It contains the actual provider/client logic for OpenAI, DeepSeek, and Anthropic.

In normal use, you do not install `assistant-runtime` or `assistant-core` directly.

You run:

- `assistant setup`
- optionally `assistant page`
- optionally `assistant settings-page`

### Setup

`setup` installs runtime/config only. It does not create pages, but it is the step that makes the assistant actually work.

It installs:

- assistant runtime wiring
- assistant config entries in `config/public.js` and `config/server.js`
- prefixed AI env values in `.env`
- assistant runtime migrations

Example:

```bash
npx jskit generate assistant setup \
  --surface admin \
  --settings-surface admin \
  --config-scope workspace \
  --ai-provider openai \
  --ai-api-key "$OPENAI_API_KEY" \
  --ai-base-url "" \
  --ai-timeout-ms 120000
```

### Assistant runtime page

```bash
npx jskit generate assistant page \
  admin/assistant/index.vue
```

### Assistant settings page

```bash
npx jskit generate assistant settings-page \
  admin/settings/index/assistant/index.vue \
  --surface admin
```

Important:

- the target file decides where the settings page lives
- `--surface` does not place the page
- `--surface` tells assistant which runtime surface that settings page configures

In the normal case, the page path and `--surface` line up. If they differ, that is an intentional cross-surface setup.

### Assistant page options

For `assistant page`:

- `<target-file>` is required
- `--name`, `--link-placement`, `--link-component-token`, and `--link-to` are optional

For `assistant settings-page`:

- `<target-file>` is required
- `--surface` is required
- `--name`, `--link-placement`, `--link-component-token`, and `--link-to` are optional

## Surface Resolution

The page path decides the surface.

If surfaces overlap, JSKIT now picks the most specific matching `pagesRoot`.

Example:

- `app.pagesRoot = "w/[workspaceSlug]"`
- `admin.pagesRoot = "w/[workspaceSlug]/admin"`
- `src/pages/w/[workspaceSlug]/admin/reports/index.vue` resolves to `admin`

That is the correct behavior. A nested surface should win over its broader parent surface.

## Troubleshooting

- If the target is not under `src/pages/...`, page-producing generators will reject it.
- If you want routed child pages inside a page, use `add-subpages`, not `outlet`.
- If you create children under an `index.vue` host, put them under `index/...`.
- If you create children under a file-route host, put them under the file route's directory.
- If placement inference is not what you want, inspect `npx jskit list placements` and then use explicit overrides.
- If `add-subpages` refuses a page, inspect that page for an existing `RouterView` or custom routed-host structure first.

## Recommended Habit

Use this order when building UI:

1. Decide the exact `src/pages/...` path.
2. Generate the page or CRUD root there.
3. Upgrade the page with `add-subpages` if it should host children.
4. Generate child pages under the correct native folder shape.
5. Only then add explicit link-placement overrides if the defaults are not suitable.
