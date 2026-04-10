# 001 UI Generator

`ui-generator` is the app-local UI scaffolding generator.

It creates page files, page links, placed elements, and routed subpage hosts.

## The Model

Three of the commands now work from an explicit target file:

- `page <target-file>`
- `add-subpages <target-file>`
- `outlet <target-file>`

That is the whole point of the current design.

The file path is the truth:

- `catalog/index.vue` means index-route page
- `catalog.vue` means file-route page
- the surface is derived from where that file lives

There is no separate route-shape mode to remember.

## The Four Commands

```bash
npx jskit generate ui-generator page
npx jskit generate ui-generator add-subpages
npx jskit generate ui-generator element
npx jskit generate ui-generator outlet
```

Use them like this:

- `page`: create this page file
- `add-subpages`: upgrade this page file into a routed subpage host
- `element`: create a reusable placed component
- `outlet`: patch this file with a plain `ShellOutlet`

## Workflow 1: Create A Page

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

`name` is optional.

If you omit it, the generator derives a label from the file path.

Examples:

- `catalog/index.vue` -> `Catalog`
- `[contactId].vue` -> `Contact Id`

## Page Links

`page` also creates a link placement entry for that page.

These options control the generated page link:

- `--link-placement`: where the link renders
- `--link-component-token`: how the link is rendered
- `--link-to`: explicit navigation target override

This is different from `element`, which still uses `--placement` because elements are arbitrary placed UI, not page links.

## Workflow 2: Upgrade A Page To Host Subpages

`add-subpages` patches an existing page into the standard host shape:

- `SectionContainerShell`
- a literal `<ShellOutlet host="..." position="sub-pages" />`
- `<RouterView />`

Example:

```bash
npx jskit generate ui-generator add-subpages \
  src/pages/admin/contacts/[contactId].vue \
  --title "Contact" \
  --subtitle "Manage contact modules."
```

It also ensures the shared support scaffold exists:

- `src/components/SectionContainerShell.vue`
- `src/components/TabLinkItem.vue`
- `packages/main/src/client/providers/MainClientProvider.js` registration for `local.main.ui.tab-link-item`

`--target` controls the outlet target:

- if omitted, the target is derived from the page path
- `--target contact-view` means `contact-view:sub-pages`
- `--target contact-view:secondary-tabs` uses an explicit custom position

Derived target examples:

- `src/pages/admin/catalog/index.vue` -> `catalog:sub-pages`
- `src/pages/admin/catalog.vue` -> `catalog:sub-pages`
- `src/pages/admin/contacts/[contactId].vue` -> `contacts-contact-id:sub-pages`
- `src/pages/admin/catalog/products/index.vue` -> `catalog-products:sub-pages`

If the page already contains a `RouterView`, `add-subpages` fails instead of trying to update an existing routed host.

## Where Child Pages Go

This is the one routing rule you need to know.

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

Why the difference:

- file-route parents already own their direct child route tree
- index-route parents need the app router’s `(nestedChildren)` reparenting hook so those sibling files render inside the parent page’s `RouterView`

## Workflow 3: Add Child Page Links

For a file-route parent:

```bash
npx jskit generate ui-generator page \
  src/pages/admin/contacts/[contactId]/notes/index.vue \
  --name "Notes"
```

For an index-route parent:

```bash
npx jskit generate ui-generator page \
  src/pages/admin/catalog/(nestedChildren)/products/index.vue \
  --name "Products"
```

When `page` finds the nearest parent page upgraded with `add-subpages`, it reuses that parent’s real outlet target, defaults the link renderer to `local.main.ui.tab-link-item`, and derives `to` from the child route automatically.

## Workflow 4: Create A Reusable Element

```bash
npx jskit generate ui-generator element \
  --name "Alerts Widget" \
  --surface admin \
  --placement shell-layout:top-right
```

Use `element` when the thing you want is not a route page.

## Workflow 5: Inject A Generic Outlet

```bash
npx jskit generate ui-generator outlet \
  src/components/ContactSummaryCard.vue \
  --host contact-view \
  --position summary-actions
```

`outlet` is intentionally small.

It adds:

- `import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";`
- `<ShellOutlet host="..." position="..." />`

It does not add:

- `RouterView`
- `SectionContainerShell`
- tab-link support scaffold

If you want routed child pages inside the page, use `add-subpages`.

## The Options That Matter

### `page`

| Option | Meaning |
| --- | --- |
| `name` | Optional label override |
| `link-placement` | Target outlet for the page link |
| `link-component-token` | Link renderer override |
| `link-to` | Explicit `props.to` override |

### `add-subpages`

| Option | Meaning |
| --- | --- |
| `target` | Optional outlet target. If omitted, it is derived from the page path. `host` means `host:sub-pages`; `host:position` is fully explicit |
| `title` | Optional `SectionContainerShell` title |
| `subtitle` | Optional `SectionContainerShell` subtitle |

### `element`

| Option | Meaning |
| --- | --- |
| `name` | Element name |
| `surface` | Target surface |
| `path` | Component directory |
| `placement` | Placement target for the element |

### `outlet`

| Option | Meaning |
| --- | --- |
| `host` | Outlet host name |
| `position` | Outlet slot key |

## Common Mistakes

- using `outlet` when you really want routed subpages
- forgetting that `index.vue` parents need `(nestedChildren)` for child routes
- guessing a link placement target instead of running `npx jskit list placements`
- forgetting `--link-to` for file-route child links when you need an explicit relative tab link
- treating `element` like a page generator

## Fast Decision Guide

If you want a page, create the page file with `page`.

If that page should host routed child pages, run `add-subpages` on the same file.

If you want a reusable placed component, use `element`.

If you only need a generic rendering slot, use `outlet`.
