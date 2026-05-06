# CRUD Scaffolding Patterns

Use when:

- creating a new CRUD-backed entity
- deciding how to create a CRUD table
- deciding whether to scaffold server first or UI first
- deciding whether a CRUD needs a migration, a generator, or both

Check first:

- the intended ownership model
- the real database table shape
- `jskit show crud-server-generator --details`
- whether the request is server-only CRUD or server-plus-UI CRUD

Rules:

- For a CRUD-backed entity, start with `jskit generate crud-server-generator scaffold ...`.
- That server scaffold is the crucial first step even if no CRUD UI will be created yet.
- Create the real table directly in the database before scaffolding. `crud-server-generator` reads the live table shape.
- If `crud-server-generator` is going to own the CRUD, do not hand-write a separate CRUD migration for that table. The generator installs and manages the CRUD migration scaffold itself.
- Do not scaffold CRUD UI, hand-build CRUD routes, or hand-build CRUD endpoints before the server CRUD package and shared resource file exist.
- Treat the generated shared resource file as the canonical CRUD contract for later UI scaffolding and CRUD behavior changes.

Avoid:

- writing a hand migration for a CRUD table that JSKIT CRUD scaffolding is supposed to own
- starting with `crud-ui-generator` before the server scaffold exists
- hand-building CRUD routes or validators that duplicate the generated server resource contract
