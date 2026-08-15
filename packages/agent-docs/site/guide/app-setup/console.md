# Owner console

Use a console when the product needs an owner-only or operator-only surface
separate from normal account and workspace administration.

```bash
npm install @jskit-ai/console-web
npm run db:migrate
```

The installed graph supplies `console-core`. Its migration and feature runtime
are discovered normally; no console generator is involved.

Use the `console/console-surface` pattern for the route tree, surface policy,
settings navigation, profile switch, and responsive shell placements.

## Product decisions

Choose who can enter the console, its route and label, which operations and
settings it owns, and how authorized people switch back to the normal product.
Do not create a console merely to host one ordinary settings page.

## Invariants

- Server policy authorizes console actions before product logic runs.
- The surface definition and route pages use the same stable surface id.
- The console switch appears only for authorized authenticated users.
- Settings navigation uses semantic placements and topology.
- Loading uses skeletons and preserves shell geometry.

The first-owner policy, if the product selects it, is a runtime product rule;
it is not a hard-coded seed account.

## Verification

Test authorized and forbidden direct entry, first-owner behavior, switching,
refresh, console settings, compact navigation, and the production build.

Do not treat hidden navigation as authorization, reuse normal-user pages by
changing only their prefix, or introduce generator ownership and appended
source fragments.
