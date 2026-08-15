# Workspace tenancy

Use JSKIT workspaces when routes, records, or permissions belong to a selected
workspace and membership or role changes access.

```bash
npm install @jskit-ai/workspaces-web
npm run db:migrate
```

The dependency graph supplies `workspaces-core` and the required users runtime.
Package migrations run from their installed locations through the application's
normal Knex command.

## Decide the tenancy model first

Choose whether the product is:

- global, with no workspace concept;
- personal, with one automatically provisioned personal workspace; or
- multi-workspace, with named workspaces, membership, invitations, and
  switching.

Do not add workspace machinery to a product that only needs an owner id on one
domain record.

## Server composition

Use `workspaces/workspace-server` for role vocabulary, creation policy,
invitations, settings, and app-owned invitation email rendering.

Workspace scope must reach repository queries. Parsing a workspace slug or
hiding an admin link is not authorization. Membership and role checks happen
before an operation discloses records or record existence.

`workspace_authenticated` and similar policies must implement their documented
membership semantics exactly; do not synthesize memberships to compensate for
a policy/runtime mismatch.

## Browser composition

Use `workspaces/workspace-surfaces` for workspace selection, invitation landing,
member administration, settings, not-found states, and semantic shell
placements.

The route slug, selected workspace, query keys, and server scope stay aligned.
Invalid workspace URLs show a deliberate not-found/forbidden state instead of
silently selecting another workspace.

Loading uses skeletons; mutation errors use toasts. Warm-cache and browser
back/forward navigation must restore the correct workspace context.

## Verification

Test create/list/select, each role boundary, invitations and expiry,
cross-workspace isolation, invalid routes, direct URLs, switching, browser
back/forward, and responsive navigation.

Do not authorize from client state, add unscoped queries, or preserve old
tenancy setup through compatibility shims.
