# @jskit-ai/ui-generator

Generate non-CRUD UI pages and outlet elements for JSKIT apps.

## Quick Start

List available placement targets in the current app:

```bash
npx jskit list placements
```

Generate a page (default placement target):

```bash
npx jskit generate @jskit-ai/ui-generator page --name "Reports Dashboard" --surface admin
```

Generate a page in a subdirectory:

```bash
npx jskit generate @jskit-ai/ui-generator page --name "Reports Dashboard" --surface admin --directory-prefix ops
```

Generate a page and place its menu entry in the workspace cog dropdown:

```bash
npx jskit generate @jskit-ai/ui-generator page --name "Reports" --surface admin --placement workspace-tools:primary-menu
```

Generate an element at a specific outlet:

```bash
npx jskit generate @jskit-ai/ui-generator element --name "Ops Panel" --surface admin --placement shell-layout:top-right
```

Generate an element with custom component path:

```bash
npx jskit generate @jskit-ai/ui-generator element --name "Alerts Widget" --surface admin --path src/widgets --placement shell-layout:top-right
```

Generate a route container page with nested outlet (for embedded sub-pages):

```bash
npx jskit generate @jskit-ai/ui-generator container --name "Practice" --surface admin
```

Generate a route container with explicit dynamic route path:

```bash
npx jskit generate @jskit-ai/ui-generator container --name "Contact" --surface admin --directory-prefix contacts --route-path "[contactId]"
```

Add a shell menu entry for that container (optional):

```bash
npx jskit generate @jskit-ai/ui-generator container --name "Practice" --surface admin --placement shell-layout:primary-menu
```

Inject an inline outlet into an existing Vue page/component:

```bash
npx jskit generate @jskit-ai/ui-generator outlet --file src/pages/w/[workspaceSlug]/admin/contacts/[contactId]/index.vue --host contact-view
```

Show generator and subcommand help:

```bash
npx jskit generate @jskit-ai/ui-generator help
npx jskit generate @jskit-ai/ui-generator outlet help
npx jskit generate @jskit-ai/ui-generator outlet
```

## Commands

- `page`: `--name --surface [--directory-prefix] [--placement]`
- `element`: `--name --surface [--path] [--placement]`
- `container`: `--name --surface [--directory-prefix] [--route-path] [--placement]`
- `outlet`: `--file --host [--position] [--mode]`

`page` also supports:

- `--placement-component-token` to override the placement component token.
- `--placement-to` to set explicit `props.to` in the generated placement block.
- if `--placement-to` is omitted and `--directory-prefix` includes a `(nestedChildren)` route group, `props.to` is auto-set to `./<page-slug>`.

## Container Workflow

- `container` creates app-owned scaffolding:
  - `src/components/SectionContainerShell.vue` (shared container shell with responsive tab row)
  - `src/components/TabLinkItem.vue` (tab link item token component)
  - `packages/main/src/client/providers/MainClientProvider.js` registration for `local.main.ui.tab-link-item`
  - `<route>.vue` as a thin wrapper around `SectionContainerShell` + `<RouterView />`, with route meta outlet declaration at `meta.jskit.placements.outlets`
  - no shell menu placement is added unless `--placement` is explicitly provided
- Child pages for a `container` go directly under the container route path, not under `(nestedChildren)`.
  - Example container route: `src/pages/admin/practice.vue`
  - Example child page path: `src/pages/admin/practice/notes/index.vue`
  - Example URL: `/admin/practice/notes`
- Use `(nestedChildren)` for the `page + outlet` pattern when the parent page is an existing `index.vue` route that should render child routes inside its own `RouterView`.

Generate a child page inside a container:

```bash
npx jskit generate @jskit-ai/ui-generator page \
  --name "Notes" \
  --surface admin \
  --directory-prefix "practice" \
  --placement practice:sub-pages \
  --placement-component-token local.main.ui.tab-link-item
```

- Generate CRUD pages into that container using `@jskit-ai/crud-ui-generator` with:
  - `--container <route-slug>`
  - `--route-path <resource-slug>`
  - optional `--placement` override (default becomes `<container>:sub-pages` for list pages)

## Inline Outlet Workflow

- `outlet` patches an app-owned Vue SFC by adding:
  - `import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";`
  - `<ShellOutlet host="<host>" position="<position>" />` in template
  - optional `<RouterView />` (when `--mode routed`, only if one does not already exist in the file)
- `--mode` supports:
  - `routed` (default): insert `RouterView` if missing
  - `outlet-only`: insert only `ShellOutlet`

## End-to-End Example: Embed Pets CRUD in Contact View

Goal: render pets CRUD pages inside `contacts/[contactId]/index.vue` using a routed outlet and tab-style placement links.

1. Inject a routed outlet into the contact page:

```bash
npx jskit generate ui-generator outlet \
  --file src/pages/w/[workspaceSlug]/admin/contacts/[contactId]/index.vue \
  --host contact-view \
  --position sub-pages \
  --mode routed
```

What each option does:

- `--file`: target Vue SFC to patch.
- `--host`: outlet host namespace (used later by placements).
- `--position`: outlet position key under that host.
- `--mode routed`: ensures `<RouterView />` exists so nested pages render inline.

2. Generate pets CRUD pages under the nested-children group and place a tab link into that outlet:

```bash
npx jskit generate crud-ui-generator \
  --namespace pets \
  --surface admin \
  --operations list,view,new,edit \
  --resource-file packages/pets/src/shared/petResource.js \
  --directory-prefix "contacts/[contactId]/(nestedChildren)" \
  --placement contact-view:sub-pages \
  --placement-component-token local.main.ui.tab-link-item \
  --placement-to ./pets \
  --id-param petId
```

What each option does:

- `--namespace pets`: CRUD namespace for generated UI artifacts.
- `--surface admin`: generate pages under admin surface routes.
- `--operations list,view,new,edit`: generate full CRUD page set.
- `--resource-file`: resource contract used to scaffold fields/forms.
- `--directory-prefix "contacts/[contactId]/(nestedChildren)"`: place generated routes under the contact context, in a route-group folder that does not appear in URL.
- `--placement contact-view:sub-pages`: append a placement targeting the outlet created in step 1.
- `--placement-component-token local.main.ui.tab-link-item`: render placement as a tab link component.
- `--placement-to ./pets`: tab link resolves relative to current contact route (for example `/contacts/538779/pets`).
- `--id-param petId`: dynamic route parameter for view/edit pages.

Expected result:

- Contact page keeps its own route and renders nested pets pages inline via `RouterView`.
- Pets routes are generated under `contacts/[contactId]/(nestedChildren)/pets/...`.
- URL remains clean (`(nestedChildren)` is not part of URL).
- A placement entry is added so the pets tab appears in `contact-view:sub-pages`.

## Placement Notes

- `--placement` expects `host:position`.
- Targets come from:
  - app-declared `<ShellOutlet host="..." position="..." />` in `src/**/*.vue`
  - app route meta `meta.jskit.placements.outlets` declarations in `src/**/*.vue`
  - installed package metadata `metadata.ui.placements.outlets`
- If `--placement` is omitted, the app default outlet is used.
