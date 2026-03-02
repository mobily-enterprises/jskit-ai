# App Drop-In Extension Contract

Status: Stage 2 baseline policy

This document defines the permanent app-owned extension directories and loader behavior.

## Directories

Server:

- `apps/jskit-value-app/server/app/extensions.d/*.server.js`
- `apps/jskit-value-app/server/app/settings.extensions.d/*.server.js`
- `apps/jskit-value-app/server/app/workers.extensions.d/*.server.js`

Client:

- `apps/jskit-value-app/src/app/extensions.d/*.client.js`
- `apps/jskit-value-app/src/app/transport/*.client.js`

## Deterministic order

- Extensions are sorted by:
  1. `order` ascending
  2. filename ascending
  3. `id` ascending

## Validation and conflict semantics

- Unknown keys fail startup.
- Duplicate extension `id` values fail startup.
- Duplicate server route ids fail startup.
- Duplicate settings field ids fail startup.
- Duplicate worker queue ids fail startup.
- Duplicate worker processor ids fail startup.
- Duplicate client route fragment ids per surface fail startup.
- Duplicate client navigation ids per surface fail startup.
- Duplicate client guard policy ids fail startup.

## Lifecycle

- Loaders are permanent (`server/app/loadExtensions.server.js`, `src/app/loadExtensions.client.js`).
- Package install/update/remove writes and manages files under `.d` directories.
- Loaders are not patched during install/update/remove.

## Reference implementation (value-app)

- `apps/jskit-value-app/server/app/settings.extensions.d/20-projects.server.js`
- `apps/jskit-value-app/server/app/settingsExtensions/projectsPreferences.server.js`
- Runtime wiring:
  - `apps/jskit-value-app/server/runtime/services.js` passes `appServerExtensions.settings` into `userSettingsService`.
  - `apps/jskit-value-app/server/modules/settings/service.js` resolves and executes extension validators/persistence/projection.
  - `apps/jskit-value-app/server/modules/settings/routes.js` exposes:
    - `GET /api/v1/settings/extensions/:extensionId`
    - `PATCH /api/v1/settings/extensions/:extensionId`
