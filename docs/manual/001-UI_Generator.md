# 001 UI Generator

`ui-generator` is for app-local UI scaffolding.

It is the generator you use when you want to shape the UI itself.

The four things it does are:

- create a route page
- create a reusable placed element
- create a routed container for sub-pages
- patch an existing Vue page with an outlet

## The Mental Model

Think in terms of these building blocks:

| Building block | What it is |
| --- | --- |
| page | A normal route page under `src/pages/...` |
| element | A reusable component rendered into an existing outlet |
| container | A parent route designed to host sub-pages |
| outlet | A `ShellOutlet` inserted into an existing Vue page |
| placement | A thing rendered into an existing outlet |

The important separation is this:

- `outlet` creates or patches a place where UI can render
- `placement` sends a page or element into a place that already exists

If you keep those two ideas separate, `ui-generator` becomes much easier.

## The Four Commands

```bash
npx jskit generate ui-generator page
npx jskit generate ui-generator element
npx jskit generate ui-generator container
npx jskit generate ui-generator outlet
```

If you want the CLI contract:

```bash
npx jskit generate ui-generator help
npx jskit generate ui-generator page help
npx jskit generate ui-generator element help
npx jskit generate ui-generator container help
npx jskit generate ui-generator outlet help
```

If you need to know where things can render:

```bash
npx jskit list placements
```

## When To Use Which Command

### Use `page`

When you want a normal route page.

Examples:

- Reports
- Notes
- Dashboard
- Availability page

### Use `element`

When you want a reusable component rendered into an existing outlet.

Examples:

- top-right shell widget
- settings form panel
- quick actions widget

### Use `container`

When you want a parent route that exists mainly to host sub-pages.

Examples:

- Practice section
- Contact tools section
- Workspace settings area with tabs or sub-pages

### Use `outlet`

When you already have a Vue page and want to patch it so it can host placed content or nested routed content.

Examples:

- existing contact view page
- custom details page that should render sub-pages inline

## Workflow 1: Create A Simple Page

This is the most basic `ui-generator` use case.

```bash
npx jskit generate ui-generator page \
  --name "Reports Dashboard" \
  --surface admin
```

What it does:

- creates a page scaffold under the selected surface
- gives you an app-owned Vue page to edit
- uses the default outlet if you do not set `--placement`

### Put the page in a subdirectory

```bash
npx jskit generate ui-generator page \
  --name "Reports Dashboard" \
  --surface admin \
  --directory-prefix ops
```

Use `directory-prefix` when the page should live under an existing route path segment.

### Put a menu entry somewhere specific

```bash
npx jskit generate ui-generator page \
  --name "Reports" \
  --surface admin \
  --placement workspace-tools:primary-menu
```

Use `placement` when you want the generated page to appear in a specific outlet-driven menu or tool area.

## Workflow 2: Create A Reusable Element

Use `element` when the thing you want is not a route page.

```bash
npx jskit generate ui-generator element \
  --name "Alerts Widget" \
  --surface admin \
  --placement shell-layout:top-right
```

What it does:

- creates a component file
- registers a placement
- renders that component into an existing `ShellOutlet`

### Put the component in a custom folder

```bash
npx jskit generate ui-generator element \
  --name "Ops Panel" \
  --surface admin \
  --path src/widgets \
  --placement shell-layout:top-right
```

Use `path` when `src/components` is not the right home for the new element.

## Workflow 3: Create A Container For Sub-Pages

Use `container` when you want a parent route whose job is to host more UI below it.

```bash
npx jskit generate ui-generator container \
  --name "Practice" \
  --surface admin
```

What it creates:

- a routed parent page
- a `ShellOutlet` for sub-pages
- a `RouterView`
- shared support components such as `SectionContainerShell`

### Add child pages to that container

For a `container`, child pages go directly under the container route path.

Example:

```bash
npx jskit generate ui-generator page \
  --name "Notes" \
  --surface admin \
  --directory-prefix "practice" \
  --placement practice:sub-pages \
  --placement-component-token local.main.ui.tab-link-item
```

That gives you:

- route file at `src/pages/.../practice/notes/index.vue`
- URL like `/practice/notes`
- a placement rendered into `practice:sub-pages`

Do not use `(nestedChildren)` for `container` child pages.

That route group belongs to the `page + outlet` pattern, where an existing folder page like `practice/index.vue` needs sibling routes reparented into its own `RouterView`.

You can also give that container a shell/menu entry:

```bash
npx jskit generate ui-generator container \
  --name "Practice" \
  --surface admin \
  --placement workspace-tools:primary-menu
```

### Use an explicit route path

```bash
npx jskit generate ui-generator container \
  --name "Contact" \
  --surface admin \
  --directory-prefix contacts \
  --route-path "[contactId]"
```

Use `route-path` when the route segment should not be derived from `name`.

## Workflow 4: Patch An Existing Page With An Outlet

Use `outlet` when the page already exists and you want to add a rendering region to it.

```bash
npx jskit generate ui-generator outlet \
  --file src/pages/w/[workspaceSlug]/admin/contacts/[contactId]/index.vue \
  --host contact-view \
  --position sub-pages \
  --mode routed
```

What it does:

- patches the target Vue file
- inserts `ShellOutlet`
- inserts `RouterView` if needed
- adds the imports needed for those components

What it does not do:

- it does not create the child pages
- it does not automatically create placements that target the outlet

Think of `outlet` as structural surgery on an existing page.

### If you only want the outlet, not routed child rendering

```bash
npx jskit generate ui-generator outlet \
  --file src/components/ContactDetailsPanel.vue \
  --host contact-view \
  --position sub-pages \
  --mode outlet-only
```

Use `outlet-only` when you want a placement area but you do not want `RouterView`.

## A Good Practical Pattern

Here is a common pattern using only `ui-generator` concepts:

1. Create a parent section with `container`.
2. Add normal route pages with `page`.
3. Add a top-right widget or settings widget with `element`.
4. Patch an old page with `outlet` only when needed.

That keeps the model clean:

- routes come from `page` or `container`
- placed widgets come from `element`
- structural retrofits come from `outlet`

## The Options That Actually Matter

Do not try to memorize every flag. Learn the ones that change the shape of the generated UI.

### Core Routing Options

| Option | Meaning |
| --- | --- |
| `name` | Display name and slug source |
| `surface` | Which app surface the output belongs to |
| `directory-prefix` | Extra path under the surface pages root |
| `route-path` | Explicit route segment for a container |

### Placement And Outlet Options

| Option | Meaning |
| --- | --- |
| `placement` | Existing target written as `host:position` |
| `host` | Outlet namespace when patching an existing page |
| `position` | Outlet slot key under that host |
| `mode` | `routed` or `outlet-only` for `outlet` |
| `placement-component-token` | Component token used to render a page placement |
| `placement-to` | Explicit `props.to` for the generated placement |

### File Location Options

| Option | Meaning |
| --- | --- |
| `path` | Component directory for `element` |
| `file` | Existing Vue file to patch for `outlet` |

## The Two Concepts People Mix Up

### `placement` vs `outlet`

These are not the same thing.

- an outlet is where something may appear
- a placement is the thing that appears there

If you are asking "where should this widget or page link render?", that is `placement`.

If you are asking "how do I make this page capable of hosting placed content or routed child content?", that is `outlet`.

### `container` vs `outlet`

These are also not the same thing.

- `container` creates a new routed parent page designed for sub-pages
- `outlet` patches an already existing page

Use `container` when you are starting a new section.

Use `outlet` when the page already exists and you want to retrofit it.

## What Each Command Changes

| Command | Main effect |
| --- | --- |
| `page` | Creates a new route page and may add a placement |
| `element` | Creates a new component and adds a placement |
| `container` | Creates a new routed container page and support components |
| `outlet` | Patches an existing Vue file |

This matters because `outlet` is the only one here that is primarily a patch command.

## Common Mistakes

- using `outlet` when a clean new `container` would be simpler
- guessing a `placement` target instead of running `npx jskit list placements`
- confusing `placement` with `host` and `position`
- using `outlet` and expecting it to create pages
- using `container` when a normal `page` is enough
- forgetting that `element` is not a route
- putting `container` child pages under `(nestedChildren)` instead of directly under the container path

## Fast Decision Guide

If you want a route page, start with `page`.

If you want a placed widget, start with `element`.

If you want a parent route that hosts more pages, start with `container`.

If you already have a page and need to patch in a rendering region, use `outlet`.

That is the real shape of `ui-generator`.
