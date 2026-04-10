# @jskit-ai/crud-ui-generator

Generate CRUD route trees from an explicit route root relative to `src/pages/...`.

## Mental Model

This generator follows the same file-driven model as `@jskit-ai/ui-generator`.

- You point at one explicit route root relative to `src/pages/...`.
- The surface is derived from that path.
- The visible route URL is derived from that path.
- The generated list-page link placement is inferred from the nearest real parent subpages host when there is one.
- Explicit overrides still exist, but they are not required for the normal case.

## Command

```bash
npx jskit generate @jskit-ai/crud-ui-generator crud \
  admin/catalog/index/products \
  --resource-file packages/products/src/shared/productResource.js
```

That generates:

- `src/pages/admin/catalog/index/products/index.vue`
- `src/pages/admin/catalog/index/products/[recordId]/index.vue`
- `src/pages/admin/catalog/index/products/new.vue`
- `src/pages/admin/catalog/index/products/[recordId]/edit.vue`
- `src/pages/admin/catalog/index/products/_components/...`

## Defaults

From the explicit `target-root`, the generator derives:

- the owning surface
- the visible CRUD route
- the default list-page placement target
- the default link component token
- the default relative `to` for nested subpage links

The generated list-page link follows the same parent-host inference as `@jskit-ai/ui-generator page`.

If you want the detailed behavior, read:

- `npx jskit generate ui-generator page help`

That is where the parent-host, tab-link, and relative `to` behavior is explained.

## Options

- `--resource-file`: required resource module path relative to the app root
- `--operations`: optional comma-separated subset of `list,view,new,edit`, defaulting to all four
- `--display-fields`: optional comma-separated subset of fields to render
- `--id-param`: optional route param name for record pages, default `recordId`
- `--link-placement`: optional link placement override for the generated list page
- `--namespace`: optional CRUD namespace override when the resource module does not expose `resource.resource`

## Route Roots

Use the real route root you want in the app:

- index-route parent child: `admin/catalog/index/products`
- nested under a record view page: `admin/customers/[customerId]/index/pets`
- file-route parent child: `admin/customers/[customerId]/orders`
- top-level route: `admin/products`

There is no separate `surface`, `directory-prefix`, `route-path`, or `container` assembly step anymore.
