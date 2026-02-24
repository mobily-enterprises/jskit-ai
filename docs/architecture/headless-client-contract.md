# Headless Client Contract

Last validated: 2026-02-24 (UTC)

This contract defines what code in `packages/**` may and may not do for client/runtime concerns.

See also: [app variability matrix](./app-variability-matrix.md).

## Scope

- Applies to package JS modules under `packages/**/src/**`.
- Vue SFC (`.vue`) usage is limited to client-element packages only:
  - `packages/billing/billing-plan-client-element`
  - `packages/chat/chat-client-element`
  - `packages/ai-agent/assistant-client-element`
  - `packages/users/profile-client-element`
- Applies to current and future apps that consume package client/runtime modules.

## Allowed in Packages

- Domain logic and state transitions.
- Runtime composables/hooks and query helpers.
- API/client transport helpers.
- Data mappers, validation, and contracts.
- Reactive/runtime utilities that stay UI-agnostic.
- Package-owned client element SFCs only in the four client-element package paths above.

## Not Allowed in Packages

- Vue SFCs outside allowed client-element package paths.
- Style imports (`.css`, `.scss`, `.sass`, `.less`, `.styl`, `.stylus`).
- Visual framework coupling (for example `vuetify`, icon packs, UI kits).
- Rendering entry assumptions (`createApp`, `defineComponent`, or other app-render bootstrapping behavior).
- UI-specific labels, layout, colors, classnames, or styling policy.

## Runtime Composition Rule

- Package client runtimes must use factory APIs with closure-scoped dependencies.
- Mutable module-level runtime configuration is not allowed.
- `configureAssistantRuntime` / `configureChatRuntime` global mutation patterns are forbidden.
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
- Optional but recommended shared UI guardrails: `npm run test:architecture:shared-ui`

CI must run both checks as required merge gates.
