# Dogandgroom Rebuild JSKIT Log

This file records every framework-side change made in `jskit-ai` while rebuilding `dogandgroom` onto the latest JSKIT baseline.

The goal is to give the maintainer a clean review trail separate from app-local migration commits.

## 2026-04-21

### Missing-row normalization in internal workspace repositories

- Problem:
  - the fresh `dogandgroom2` recap baseline could not seed the first local dev user in `personal` tenancy
  - `workspaces.core.profileSyncLifecycleContributor` called `internal.repository.workspaces.findPersonalByOwnerUserId()`
  - that repository wrapper defaulted `undefined` query results to `{}` before normalization, so an empty result was treated as a real row and failed on `is_personal`
- Root cause:
  - several internal repository helper functions used `function normalizeXRecord(payload = {})`
  - their null-guard checked `if (!payload)` after the default parameter had already converted `undefined` into `{}`.
- Fix:
  - remove the default object from the internal record-normalization wrappers so missing rows stay `null`
  - add regression coverage for the workspace path that failed in the fresh baseline
- Files:
  - `packages/workspaces-core/src/server/common/repositories/workspacesRepository.js`
  - `packages/workspaces-core/src/server/common/repositories/workspaceMembershipsRepository.js`
  - `packages/workspaces-core/src/server/common/repositories/workspaceInvitesRepository.js`
  - `packages/users-core/src/server/common/repositories/userProfilesRepository.js`
  - `packages/workspaces-core/test/workspacesRepository.test.js`
  - `packages/users-core/test/repositoryContracts.test.js`
- Verification:
  - `npm test --workspace @jskit-ai/workspaces-core`
  - `npm test --workspace @jskit-ai/users-core` ran, but it still contains an unrelated pre-existing scaffold-version contract failure outside this fix

### Workspace CRUD providers omitted routeSurfaceRequiresWorkspace

- Problem:
  - the current CRUD server scaffold generated providers that only passed `routeSurface` and `routeRelativePath` into `registerRoutes()`
  - workspace-aware CRUDs therefore booted with an incomplete route contract even though the generated `registerRoutes.js` already supports `routeSurfaceRequiresWorkspace`
- Root cause:
  - `packages/crud-server-generator/templates/src/local-package/server/CrudProvider.js` never forwarded `crudPolicy.surfaceDefinition.requiresWorkspace`
- Fix:
  - add `routeSurfaceRequiresWorkspace: crudPolicy.surfaceDefinition.requiresWorkspace === true` to the provider template
  - lock the template contract with a focused test assertion
- Files:
  - `packages/crud-server-generator/templates/src/local-package/server/CrudProvider.js`
  - `packages/crud-server-generator/test/buildTemplateContext.test.js`
- Verification:
  - `npm test --workspace @jskit-ai/crud-server-generator`

### CRUD add/edit forms kept dead lookup prop contracts

- Problem:
  - no-lookup CRUD pages now correctly skip the lookup runtime setup in the page script
  - but the shared add/edit form template still declared `resolveLookupItems`/`resolveLookupLoading`/`resolveLookupSearch`/`setLookupSearch` as required props even when neither mode used lookup fields
- Root cause:
  - the page template context already knew when lookup form props were empty, but the shared form template had unconditional prop definitions
- Fix:
  - make the shared form’s lookup prop definitions conditional on whether the create or edit mode actually includes lookup fields
  - add template-context assertions for both the no-lookup and lookup-enabled cases
- Files:
  - `packages/crud-ui-generator/templates/src/pages/admin/ui-generator/AddEditForm.vue`
  - `packages/crud-ui-generator/src/server/buildTemplateContext.js`
  - `packages/crud-ui-generator/test/buildTemplateContext.test.js`
- Verification:
  - `npm test --workspace @jskit-ai/crud-ui-generator`

### CRUD server generator imported unused non-nullable time schemas

- Problem:
  - a fresh `services` scaffold in `dogandgroom2` failed lint before any app-local patching
  - the generated `serviceResource.js` imported both `HTML_TIME_STRING_SCHEMA` and `NULLABLE_HTML_TIME_STRING_SCHEMA` even though every time column in that table was nullable
- Root cause:
  - `packages/crud-server-generator/src/server/buildTemplateContext.js` used a coarse `needsHtmlTimeSchemas` boolean based on “any time column exists”
  - the validator import builder therefore pulled in both time schema helpers instead of the exact subset the generated schemas referenced
- Fix:
  - derive the actual set of referenced time-schema imports from the generated columns
  - import only the nullable and/or non-nullable time schema helpers that the resource will really use
  - add regression coverage for both nullable-only and non-nullable-only time columns
- Files:
  - `packages/crud-server-generator/src/server/buildTemplateContext.js`
  - `packages/crud-server-generator/test/buildTemplateContext.test.js`
- Verification:
  - `npm test --workspace @jskit-ai/crud-server-generator`
