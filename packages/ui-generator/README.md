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
npx jskit generate @jskit-ai/ui-generator element --name "Ops Panel" --surface admin --placement workspace-settings:forms
```

Generate an element with custom component path:

```bash
npx jskit generate @jskit-ai/ui-generator element --name "Alerts Widget" --surface admin --path src/widgets --placement shell-layout:top-right
```

Generate a route container page with nested outlet (for embedded sub-pages):

```bash
npx jskit generate @jskit-ai/ui-generator container --name "Practice" --surface admin
```

## Commands

- `page`: `--name --surface [--directory-prefix] [--placement]`
- `element`: `--name --surface [--path] [--placement]`
- `container`: `--name --surface [--directory-prefix] [--placement]`

## Container Workflow

- `container` creates app-owned scaffolding:
  - `src/components/SectionContainerShell.vue` (shared container shell with responsive tab row)
  - `src/components/SectionShellTabLinkItem.vue` (tab link item token component)
  - `packages/main/src/client/providers/MainClientProvider.js` registration for `local.main.ui.section-shell.tab-link-item`
  - `<route>.vue` as a thin wrapper around `SectionContainerShell` + `<RouterView />`
- Generate CRUD pages into that container using `@jskit-ai/crud-ui-generator` with:
  - `--container <route-slug>`
  - `--route-path <resource-slug>`
  - optional `--placement` override (default becomes `<container>:sub-pages` for list pages)

## Placement Notes

- `--placement` expects `host:position`.
- Targets come from:
  - app-declared `<ShellOutlet host="..." position="..." />` in `src/**/*.vue`
  - installed package metadata `metadata.ui.placements.outlets`
- If `--placement` is omitted, the app default outlet is used.
