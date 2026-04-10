# 001 UI Generator

`@jskit-ai/ui-generator` is the app-local UI scaffolding generator.

It is also the reference mental model for the other page-producing generators:

- `@jskit-ai/ui-generator page <target-file>`
- `@jskit-ai/crud-ui-generator crud <target-root>`
- `@jskit-ai/assistant page <target-file>`
- `@jskit-ai/assistant settings-page <target-file>`

## Basic Commands

List placement targets in the current app:

```bash
npx jskit list placements
```

Inspect generator help:

```bash
npx jskit generate @jskit-ai/ui-generator help
npx jskit generate @jskit-ai/ui-generator page help
npx jskit generate @jskit-ai/ui-generator add-subpages help
npx jskit generate @jskit-ai/ui-generator element help
npx jskit generate @jskit-ai/ui-generator outlet help
```

Core command shapes:

```bash
npx jskit generate @jskit-ai/ui-generator page <target-file>
npx jskit generate @jskit-ai/ui-generator add-subpages <target-file>
npx jskit generate @jskit-ai/ui-generator element --name "<name>" --surface <surface>
npx jskit generate @jskit-ai/ui-generator outlet <target-file> --host <host>
```

## Basic Examples

Create an index-route page:

```bash
npx jskit generate @jskit-ai/ui-generator page \
  src/pages/admin/catalog/index.vue \
  --name "Catalog"
```

Create a file-route page:

```bash
npx jskit generate @jskit-ai/ui-generator page \
  src/pages/admin/contacts/[contactId].vue \
  --name "Contact"
```

Upgrade an existing page into a routed subpage host:

```bash
npx jskit generate @jskit-ai/ui-generator add-subpages \
  src/pages/admin/contacts/[contactId].vue \
  --title "Contact" \
  --subtitle "Manage contact modules."
```

Create a child page under that host:

```bash
npx jskit generate @jskit-ai/ui-generator page \
  src/pages/admin/contacts/[contactId]/notes/index.vue \
  --name "Notes"
```

Create a reusable placed element:

```bash
npx jskit generate @jskit-ai/ui-generator element \
  --name "Alerts Widget" \
  --surface admin \
  --placement shell-layout:top-right
```

Inject a plain generic outlet into an existing Vue file:

```bash
npx jskit generate @jskit-ai/ui-generator outlet \
  src/components/ContactSummaryCard.vue \
  --host contact-view \
  --position summary-actions
```

## Mental Model

`page`, `add-subpages`, and `outlet` all work from explicit files.

The file path is the truth:

- `catalog/index.vue` means index-route page
- `catalog.vue` means file-route page
- the owning surface is derived from where the file lives
- nearest parent subpage hosts drive default tab placement

There is no separate route-shape flag to remember.

## Page Links

`page` creates the page file and appends a page-link placement block for it.

If a parent page has already been upgraded with `add-subpages`, `page` will:

- reuse the parent's real outlet target
- default the link renderer to `local.main.ui.tab-link-item`
- derive `props.to` from the child route automatically

Otherwise it falls back to the app shell default placement target.

## Routed Subpages

`add-subpages` upgrades an existing page into the standard routed host shape:

- `SectionContainerShell`
- `ShellOutlet host="..." position="sub-pages"`
- `RouterView`

It also ensures the shared support scaffold exists:

- `src/components/SectionContainerShell.vue`
- `src/components/TabLinkItem.vue`
- `packages/main/src/client/providers/MainClientProvider.js` registration for `local.main.ui.tab-link-item`

If the page already contains a `RouterView`, `add-subpages` fails instead of trying to patch an existing routed host.

## Child Route Placement Rule

If the parent page is a file route:

- parent: `src/pages/admin/catalog.vue`
- child pages go under: `src/pages/admin/catalog/...`

Example:

- `src/pages/admin/catalog/products/index.vue`

If the parent page is an index route:

- parent: `src/pages/admin/catalog/index.vue`
- child pages go under: `src/pages/admin/catalog/(nestedChildren)/...`

Example:

- `src/pages/admin/catalog/(nestedChildren)/products/index.vue`

That `(nestedChildren)` route-group folder is the centralized router trick that reparents sibling files into the parent page's `RouterView`.

## Options

### `page`

Required:

- `<target-file>`

Optional:

- `--name`: label override for the page and its generated link
- `--link-placement`: explicit page-link placement target
- `--link-component-token`: explicit page-link renderer override
- `--link-to`: explicit `props.to` override for the page link

Example:

```bash
npx jskit generate @jskit-ai/ui-generator page \
  src/pages/admin/reports/index.vue \
  --name "Reports" \
  --link-placement shell-layout:secondary-menu
```

### `add-subpages`

Required:

- `<target-file>`

Optional:

- `--target`: outlet target override
- `--title`: `SectionContainerShell` title
- `--subtitle`: `SectionContainerShell` subtitle

`--target` rules:

- omit it to derive the host from the page path
- `--target contact-view` means `contact-view:sub-pages`
- `--target contact-view:secondary-tabs` uses an explicit custom position

Derived target examples:

- `src/pages/admin/catalog/index.vue` -> `catalog:sub-pages`
- `src/pages/admin/catalog.vue` -> `catalog:sub-pages`
- `src/pages/admin/contacts/[contactId].vue` -> `contacts-contact-id:sub-pages`
- `src/pages/admin/catalog/products/index.vue` -> `catalog-products:sub-pages`

### `element`

Required:

- `--name`
- `--surface`

Optional:

- `--path`: component directory, default `src/components`
- `--placement`: placement target for the element

Example:

```bash
npx jskit generate @jskit-ai/ui-generator element \
  --name "Ops Panel" \
  --surface admin \
  --path src/widgets \
  --placement workspace-settings:forms
```

### `outlet`

Required:

- `<target-file>`
- `--host`

Optional:

- `--position`: outlet slot key, default `sub-pages`

`outlet` is intentionally small. It only adds:

- `import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";`
- `<ShellOutlet host="..." position="..." />`

It does not add:

- `RouterView`
- `SectionContainerShell`
- routed subpage scaffolding

Use `add-subpages` when the goal is routed child pages inside a page.

## Related Generators

The same file-driven model now applies across UI generators.

CRUD UI:

```bash
npx jskit generate @jskit-ai/crud-ui-generator crud \
  src/pages/admin/catalog/(nestedChildren)/products \
  --resource-file packages/products/src/shared/productResource.js
```

Assistant runtime/config:

```bash
npx jskit generate @jskit-ai/assistant setup \
  --surface admin \
  --settings-surface admin \
  --config-scope global \
  --ai-provider openai \
  --ai-api-key "$OPENAI_API_KEY" \
  --ai-base-url "" \
  --ai-timeout-ms 120000
```

Assistant runtime page:

```bash
npx jskit generate @jskit-ai/assistant page \
  src/pages/admin/assistant/index.vue
```

Assistant settings page:

```bash
npx jskit generate @jskit-ai/assistant settings-page \
  src/pages/admin/settings/(nestedChildren)/assistant/index.vue \
  --surface admin
```

## Common Mistakes

- using `outlet` when you really want routed subpages
- forgetting that `index.vue` parents need `(nestedChildren)` for child routes
- guessing a link placement target instead of running `npx jskit list placements`
- treating `element` like a page generator

## Fast Decision Guide

If you want a page, create the page file with `page`.

If that page should host routed child pages, run `add-subpages` on the same file.

If you want a reusable placed component, use `element`.

If you only need a generic rendering slot, use `outlet`.
