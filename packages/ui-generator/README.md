# @jskit-ai/ui-generator

Generate app-local UI pages, page links, placed elements, and routed subpage hosts for JSKIT apps.

## Quick Start

List available placement targets in the current app:

```bash
npx jskit list placements
```

Create a normal page at an explicit file:

```bash
npx jskit generate @jskit-ai/ui-generator page \
  admin/reports-dashboard/index.vue \
  --name "Reports Dashboard"
```

Create a file-route page:

```bash
npx jskit generate @jskit-ai/ui-generator page \
  admin/contacts/[contactId].vue \
  --name "Contact"
```

Upgrade an existing page into a routed subpage host:

```bash
npx jskit generate @jskit-ai/ui-generator add-subpages \
  admin/contacts/[contactId].vue \
  --title "Contact" \
  --subtitle "Manage contact modules."
```

Create a reusable placed element:

```bash
npx jskit generate @jskit-ai/ui-generator placed-element \
  --name "Alerts Widget" \
  --surface admin
```

Inject a plain generic outlet into an existing Vue file:

```bash
npx jskit generate @jskit-ai/ui-generator outlet \
  src/components/ContactSummaryCard.vue \
  --target contact-view:summary-actions
```

## Commands

- `page <target-file>`: create a route page at that exact file relative to `src/pages/` and add a link placement entry for it.
- `add-subpages <target-file>`: upgrade an existing page relative to `src/pages/` into the standard `SectionContainerShell + ShellOutlet + RouterView` host shape.
- `placed-element`: create a reusable component and register a placement for it.
- `outlet <target-file>`: inject a plain `ShellOutlet` into an existing Vue SFC.

For `placed-element`, the default placement target is `shell-layout:top-right`.
Use `--placement host:position` to override it.

## The Mental Model

`page` and `add-subpages` operate on explicit page files relative to `src/pages/`. `outlet` still targets an explicit Vue file path relative to the app root.

That means:

- `catalog/index.vue` is obviously an index-route page
- `catalog.vue` is obviously a file-route page
- there is no extra route-shape flag to remember
- the owning surface is derived from where the file lives

This is the reference model for JSKIT page-producing generators.

- `@jskit-ai/ui-generator page <target-file>` works from an explicit page file relative to `src/pages/`.
- `@jskit-ai/crud-ui-generator crud <target-root>` works from an explicit route root relative to `src/pages/`.
- `@jskit-ai/assistant page <target-file>` and `settings-page <target-file>` work from explicit page files relative to `src/pages/`.

## Page Links

`page` creates a page file and appends a link placement block for it.

These options control that generated page link:

- `--link-placement`: where the page link renders
- `--link-component-token`: how the page link is rendered
- `--link-to`: explicit `props.to` override for the page link

This is intentionally separate from `placed-element`, which still uses `--placement` because it places arbitrary UI, not a page link.

## Routed Subpages

`add-subpages` is the only routed-subpages command.

It upgrades an existing page so the page itself owns:

- `SectionContainerShell`
- `ShellOutlet target="...:sub-pages"`
- `RouterView`

`--target` controls that outlet target:

- if omitted, the target is derived from the page path
- `--target contact-view` means `contact-view:sub-pages`
- `--target contact-view:secondary-tabs` uses an explicit custom position

Derived target examples:

- `src/pages/admin/catalog/index.vue` -> `catalog:sub-pages`
- `src/pages/admin/catalog.vue` -> `catalog:sub-pages`
- `src/pages/admin/contacts/[contactId].vue` -> `contacts-contact-id:sub-pages`
- `src/pages/admin/catalog/products/index.vue` -> `catalog-products:sub-pages`

If the page already contains a `RouterView`, `add-subpages` fails instead of trying to update an existing routed host.

It also ensures the shared support scaffold exists:

- `src/components/SectionContainerShell.vue`
- `src/components/menus/TabLinkItem.vue`
- `packages/main/src/client/providers/MainClientProvider.js` registration for `local.main.ui.tab-link-item`

## Child Route Placement Rule

Child routes attach differently depending on the parent page file shape.

If the parent is a file route:

- parent: `src/pages/admin/catalog.vue`
- child pages go under: `src/pages/admin/catalog/...`
- example child page: `src/pages/admin/catalog/products/index.vue`

If the parent is an index route:

- parent: `src/pages/admin/catalog/index.vue`
- child pages go under: `src/pages/admin/catalog/index/...`
- example child page: `src/pages/admin/catalog/index/products/index.vue`

That `index/...` folder shape is the native file-based routing rule for nesting children under an `index.vue` page.

## Example: File Route Parent

Create the parent page:

```bash
npx jskit generate @jskit-ai/ui-generator page \
  admin/contacts/[contactId].vue \
  --name "Contact"
```

Upgrade it to host subpages:

```bash
npx jskit generate @jskit-ai/ui-generator add-subpages \
  admin/contacts/[contactId].vue \
  --title "Contact" \
  --subtitle "Manage contact modules."
```

Generate a child page link inside that host:

```bash
npx jskit generate @jskit-ai/ui-generator page \
  admin/contacts/[contactId]/notes/index.vue \
  --name "Notes"
```

## Example: Index Route Parent

Create the parent page:

```bash
npx jskit generate @jskit-ai/ui-generator page \
  admin/catalog/index.vue \
  --name "Catalog"
```

Upgrade it to host subpages:

```bash
npx jskit generate @jskit-ai/ui-generator add-subpages \
  admin/catalog/index.vue \
  --title "Catalog"
```

Because the parent page is `index.vue`, nested child pages live under the matching `index/` folder.

Generate a child page link inside that host:

```bash
npx jskit generate @jskit-ai/ui-generator page \
  admin/catalog/index/products/index.vue \
  --name "Products"
```

When `page` finds the nearest parent page upgraded with `add-subpages`, it reuses that parent’s real outlet target, defaults the link renderer to `local.main.ui.tab-link-item`, and derives `to` from the child route automatically.

## Generic Outlet Injection

`outlet` is intentionally small.

It only adds:

- `import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";`
- `<ShellOutlet target="host:position" />`

It does not:

- add `RouterView`
- add `SectionContainerShell`
- add routed subpage scaffolding

Use `add-subpages` when the goal is routed child pages inside a page.
