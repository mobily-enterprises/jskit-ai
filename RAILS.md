# RAILS.md

This file defines naming, placement, and layering rules for this codebase.
Treat it as the source of truth for project structure.

## 1) Core intent

- Keep architecture predictable.
- Keep naming explicit.
- Avoid duplicate patterns and accidental one-off conventions.
- Optimize for least surprise for future contributors.

## 2) Backend layer flow

Request flow is always:

1. `routes` (transport policy, route schema, URL mapping)
2. `controllers` (HTTP input/output, status codes, error shaping)
3. `services` (business logic and validation orchestration)
4. `repositories` (Knex queries + row mapping)
5. DB

Rules:

- Controllers do not run SQL.
- Services do not access Knex directly.
- Repositories do not contain business rules.
- Keep contracts stable for `/api/session`, `/api/history`, `/api/annuityCalculator`.

## 3) Backend naming and placement

- `routes/*.js`: route registration and schema.
- `controllers/*Controller.js`: HTTP handlers only.
- `services/*Service.js`: business/use-case logic.
- `repositories/*Repository.js`: DB access only.
- `migrations/*.cjs`: schema changes.
- `seeds/*.cjs`: initial/sample data only.

Repository mapper pattern:

- `map<Entity>RowRequired(row)` throws when `row` is missing.
- `map<Entity>RowNullable(row)` returns `null` or delegates to required mapper.

API schema naming:

- Schema files live in `lib/schemas/`.
- Use endpoint-centric file names:
  - `<endpoint>.request.js`
  - `<endpoint>.response.js`
- Example:
  - `annuityCalculator.request.js`
  - `annuityCalculator.response.js`
- Export names are surface-specific:
  - `<endpoint>RequestBodySchema` for request `body`.
  - `<endpoint>RequestQuerySchema` for request `querystring`.
  - `<endpoint>RequestParamsSchema` for request `params`.
  - `<endpoint>RequestHeadersSchema` for request `headers`.
  - `<endpoint>ResponseSchema` for primary success response.
- Params schemas are mandatory only for routes that include path params (example: `/users/:userId`).
- Keep params/query/body/header schemas in the same `<endpoint>.request.js` by default.
- If a route needs status-specific response schemas, use:
  - `<endpoint>Response<StatusCode>Schema` (example: `sessionResponse503Schema`).
- Define only schema surfaces a route actually uses.
- Shared error response schemas must live in a dedicated shared schema module (for example `commonErrors.response.js`) and be reused by routes.

## 4) Frontend naming and placement

View-level components:

- `src/views/*View.vue` for route screens only.

UI component types:

- `*Form.vue` for input/edit workflows.
- `*List.vue` for collection rendering and paging.
- `*Panel.vue` only when it is not specifically a form or list.

Colocation rule (default):

- If a composable is single-consumer and UI-specific, colocate with component:
  - `src/components/<feature-kebab>/<ComponentName>.vue`
  - `src/components/<feature-kebab>/use<ComponentName>.js`

Examples in this repo:

- `src/components/annuity-calculator-form/AnnuityCalculatorForm.vue`
- `src/components/annuity-calculator-form/useAnnuityCalculatorForm.js`
- `src/components/annuity-history-list/AnnuityHistoryList.vue`
- `src/components/annuity-history-list/useAnnuityHistoryList.js`

Shared client utilities:

- `src/features/<domain>/*.js` for domain modules (request/presentation/errors/model).
- `src/utils/*.js` for generic helpers.
- `src/composables/*.js` only for genuinely cross-feature composables.

## 5) Shared code between client/server

- Use `shared/` for runtime-shared JS modules.
- Keep these modules framework-agnostic and side-effect-free.
- Export plain functions/constants only.

## 6) Tests and naming

- Keep tests near behavior type:
  - `tests/client/*` for client modules/composables.
  - `tests/views/*` for Vue view/component behavior.
  - `tests/*.test.js` (Node test runner) for backend/service/repository/server.
- Test file names should mirror module names where practical.

## 7) Imports and module format

- Project is ESM-first (`"type": "module"`).
- Use explicit relative imports with `.js` where required by runtime/tooling.
- Keep `knexfile.cjs` as CommonJS (Knex CLI compatibility).

## 8) Change checklist (must pass)

- Naming follows this file.
- Layer boundaries are respected.
- Lint passes.
- Relevant tests pass.
- No dead files left from renamed/moved modules.
