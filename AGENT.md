# AGENT.md

These instructions govern all commits in this repository.

## Mandatory read first

- Read and follow `RAILS.md` before making changes.
- `RAILS.md` is the source of truth for:
  - naming conventions
  - file placement
  - layer boundaries
- If this file and `RAILS.md` conflict, follow `RAILS.md`.

## Architecture rules

- Respect strict layer separation:
  - `server.js` + `routes/`: transport wiring, routing, schema registration.
  - `controllers/`: HTTP concerns only (parsing, status codes, response shaping).
  - `services/`: business rules, validation, aggregation.
  - `repositories/`: database access (Knex queries, row mapping).
- Never leak SQL/Knex calls into controllers or services.
- Keep business rules out of repositories; they should only return mapped data.

## Surface architecture (app/admin/...)

- Surface IDs and URL prefixes are defined in `shared/routing/surfaceRegistry.js`.
- Route/path helpers read from that registry in `shared/routing/surfacePaths.js`.
- Workspace access policies per surface live in `surfaces/` and are registered in `surfaces/index.js`.
- Client runtime dispatch is map-based (not if/else):
  - app bootstrap dispatch: `src/main.js`
  - router factory dispatch: `src/router.js`

### Adding a new surface

1. Add surface id + prefix in `shared/routing/surfaceRegistry.js`.
2. Add workspace access policy in `surfaces/<newSurface>Surface.js`.
3. Register that policy in `surfaces/index.js` (`SURFACE_ACCESS_RULES`).
4. Add router for the new surface (usually `src/router.<newSurface>.js`).
5. Add mount entrypoint if needed (usually `src/main.<newSurface>.js`).
6. Register router in `src/router.js` (`ROUTER_BY_SURFACE`).
7. Register mount in `src/main.js` (`SURFACE_BOOTSTRAP`).
8. Add/update shell + routes for the new surface as needed.

## Repository pattern guide

1. **File naming**: use `<entity>Repository.js` (e.g. `paymentsRepository.js`).
2. **Dependencies**:
   - Import `db` from `db/knex.js`.
   - Reuse shared helpers (e.g. `toIsoString` from `lib/dateUtils.js`).
3. **Mappers**:
   - Provide one strict mapper (`map<Entity>RowRequired` that throws when `row` is falsy).
   - Provide a nullable helper (`map<Entity>RowNullable` that returns `null` or delegates to the strict mapper).
   - Keep snake_case → camelCase conversions inside the mapper only.
4. **Queries**:
   - Export explicit methods (`findById`, `findBySupabaseUserId`, `insert`, etc.).
   - Always use parameterized Knex queries.
   - Return mapper-backed objects; do not expose raw rows.
5. **Data hygiene**:
   - Convert integer/count fields with `Number(...)`.
   - Keep financial decimal fields as strings unless a caller explicitly asks for numeric conversion.
   - Append-only tables (`calculation_logs`) do not require update/delete unless requested.
6. **Exports**: expose only repository functions (and mapper helpers only when another module consumes them).

### Repository starter template

```js
import { db } from "../db/knex.js";
import { toIsoString } from "../lib/dateUtils.js";

function mapThingRowRequired(row) {
  if (!row) {
    throw new TypeError("mapThingRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    createdAt: toIsoString(row.created_at)
  };
}

function mapThingRowNullable(row) {
  if (!row) {
    return null;
  }
  return mapThingRowRequired(row);
}

async function findById(id) {
  const row = await db("things").where({ id }).first();
  return mapThingRowNullable(row);
}

async function list() {
  const rows = await db("things").orderBy("created_at", "desc");
  return rows.map(mapThingRowRequired);
}

export { findById, list };
```

## PR & change hygiene

- Keep API contracts stable (versions) for:
  - `GET /api/session`
  - `GET /api/history`
  - `POST /api/annuityCalculator`
- If an API contract changes, bump a versioned path/field and document it.
- Add or refresh tests covering repository behavior and service regressions when touching those layers.
