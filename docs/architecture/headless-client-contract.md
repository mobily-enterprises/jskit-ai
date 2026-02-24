# Headless Client Contract

This contract defines what code in `packages/**` may and may not do for client/runtime concerns.

See also: [app variability matrix](./app-variability-matrix.md).

## Scope

- Applies to every package source file under `packages/**/src/**`.
- Applies to current and future apps that consume package client/runtime modules.

## Allowed in Packages

- Domain logic and state transitions.
- Runtime composables/hooks and query helpers.
- API/client transport helpers.
- Data mappers, validation, and contracts.
- Reactive/runtime utilities that stay UI-agnostic.

## Not Allowed in Packages

- Vue SFCs (`.vue`) or any render/component ownership.
- Style imports (`.css`, `.scss`, `.sass`, `.less`, `.styl`, `.stylus`).
- Visual framework coupling (for example `vuetify`, icon packs, UI kits).
- Rendering entry assumptions (`createApp`, `defineComponent`, or other app-render bootstrapping behavior).
- UI-specific labels, layout, colors, classnames, or styling policy.

## Runtime Composition Rule

- Package client runtimes must use factory APIs with closure-scoped dependencies.
- Mutable module-level runtime configuration is not allowed.
- App-specific dependency wiring belongs in app composition roots (for example `apps/*/src/modules/*/runtime.js`).

## Wrapper Rule

- App wrappers are allowed only when they add one of:
  - app-specific transformation,
  - app-specific policy,
  - app-specific dependency composition,
  - compatibility boundary with a documented reason.
- Pure pass-through wrappers must be removed.

## Enforcement

- `node --test tests/architecture/client-architecture.guardrails.test.mjs`
- `npm run lint:architecture:client`

CI must run both checks as required merge gates.
