# Last Items

- [x] 1. Convert `assistant-runtime` route param composition to real schema definitions.
  - Current problem: `packages/assistant-runtime/src/server/registerRoutes.js` still builds `params` as validator arrays like `[workspaceScopeSupport.params, assistantSurfaceRouteParams]`.
  - Why it matters: the route layer now expects a single schema definition object, and the real router path throws on this shape.

- [ ] 2. Convert `assistant-runtime` action input composition to real schema definitions.
  - Current problem: `packages/assistant-runtime/src/server/actions.js` still uses legacy input arrays for `query`, `params`, `body`, and `patch` composition.
  - Why it matters: this keeps one package on the old contract model after the rest of the repo moved to single schema definitions.

- [x] 3. Add regression coverage that exercises `assistant-runtime` through the real route validator path.
  - Current problem: the current tests mostly stub `router.register(...)` and do not force route-validator compilation for the workspace-scoped assistant routes.
  - Why it matters: that is how the legacy array-shaped params path survived without failing tests.

- [ ] 4. Collapse `auth-provider-supabase-core` onto the shared auth command schema contract.
  - Current problem: shared auth commands now define `json-rest-schema` contracts, but server flows still use manual parsers like `validators.registerInput(...)`, `validators.loginInput(...)`, `validators.forgotPasswordInput(...)`, `validatePasswordRecoveryPayload(...)`, and other handwritten payload parsers.
  - Why it matters: the shared schema is no longer the one owner of auth input semantics, and some flows still validate one subset of fields while reading other values directly from raw `payload`.

- [ ] 5. Decide whether CRUD list filters should remain a deliberate two-phase exception or be pulled fully under the schema contract.
  - Current problem: `packages/crud-core/src/server/listFilters.js` still splits query validation from final normalized filter projection.
  - Why it matters: it is one of the few remaining places where “schema validates and normalizes” is not fully true.

- [ ] 6. If CRUD list filters stay two-phase, document that exception explicitly in the architecture docs.
  - Current problem: the codebase otherwise presents a single-contract validation model.
  - Why it matters: if the two-phase list-filter model remains intentional after the decision above, it should be called out instead of looking like accidental drift.
