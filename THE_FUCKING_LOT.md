# THE FUCKING LOT

Total plan for batteries-included database-backed JSKIT local auth.

## Status

- [x] V1 implemented in `@jskit-ai/auth-provider-local-db-core`.
- [x] This is the full batteries-included DB-backed local auth v1, not the narrower password strategy/lazy projector work.
- [x] The current local auth default remains the file backend unless the DB package is installed and `AUTH_LOCAL_BACKEND=db` is selected.

## Target Outcome

- [x] JSKIT ships a DB-backed local auth path that works without app-specific backend code.
- [x] Installing the DB-backed package makes provider ordering deterministic; it must not depend on a user manually arranging providers.
- [x] The package owns:
  - [x] `auth_local_users`
  - [x] `auth_local_sessions`
  - [x] `auth_local_recovery`
- [x] The package registers an `auth.local.backend` implementation backed by the JSKIT database runtime.
- [x] Existing stock auth UI continues to work unchanged.
- [x] Apps can still override password hashing through `auth.local.passwordStrategy`.
- [x] Apps can still project provider identities into app users through `auth.profile.projector`.
- [x] Apps can extend v1 through auth service decorators, backend wrapping, and sidecar-owned packages/tables.
- [x] Provider-neutral lifecycle events are a later enhancement unless a concrete first-party consumer exists.
- [x] Apps can replace the backend entirely when the package-owned schema is not a fit.

## V1 Scope

- [x] Build the elegant core only:
  - [x] `@jskit-ai/auth-provider-local-db-core`
  - [x] three package-owned tables
  - [x] DB backend implementing the existing `auth.local.backend` contract
  - [x] provider registration for `AUTH_LOCAL_BACKEND=db`
  - [x] focused tests against the local auth service contract
  - [x] docs for use as-is, extend around it, and replace it
- [x] Apply the existing `authServiceDecoratorRegistry` to local auth, matching Supabase.
- [x] Add a narrow local-auth register hook decorator with explicit blocking/non-blocking failure semantics.
- [x] Defer provider-neutral lifecycle events until there is a concrete consumer.
- [x] Defer any separate hook system or backend wrapper registry.
- [x] Defer MFA, login-attempt tables, rate-limit tables, cleanup jobs, and dialect-specific optimizations.
- [x] Do not make v1 larger than the storage backend problem.

## Database Portability

- [x] Database-independent means portable across JSKIT-supported SQL runtimes, not arbitrary databases.
- [x] V1 uses portable Knex/schema behavior intended for:
  - [x] `@jskit-ai/database-runtime-mysql`
  - [x] `@jskit-ai/database-runtime-postgres`
- [x] V1 uses Knex through JSKIT's existing database runtime:
  - [x] `jskit.database.knex`
  - [x] `jskit.database.transactionManager`
- [x] V1 does not support non-SQL stores directly.
- [x] Non-SQL or unusual SQL storage remains a replacement-backend use case.

## Product Model

- [x] Use it as-is:
  - [x] install local auth
  - [x] install DB local auth
  - [x] set `AUTH_LOCAL_BACKEND=db`
  - [x] run migrations
  - [x] register/login/recovery work without custom backend code
- [x] Extend around it:
  - [x] register auth service decorators for service-level extension points
  - [x] wrap the backend for policy/audit/observability when needed
  - [x] add sidecar tables that reference package-owned auth ids
  - [x] use the local register hook decorator for simple after-register work
  - [x] listen to provider-neutral events only after that later event seam exists
- [x] Replace it:
  - [x] register a custom `auth.local.backend`
  - [x] own the alternate schema and migration path
  - [x] keep the public auth service contract intact

## Non-Negotiables

- [x] Do not store local auth password hashes in `users-core` profile tables.
- [x] Do not add app-specific columns to package-owned local auth tables.
- [x] Do not make `users.email` or `users.password_hash` the credential source of truth.
- [x] Do not make the password strategy responsible for persistence.
- [x] Do not make profile projection responsible for credential storage.
- [x] Do not require app code for the default DB-backed path.
- [x] Keep the v1 extension contract as decorate, wrap, and sidecar.
- [x] Treat provider-neutral events as a later extension seam, not v1 scope.
- [x] Keep replacement possible through `auth.local.backend`.
- [x] Keep file-backed local auth usable without database dependencies.

## Recommended Package Shape

- [x] Add a new runtime package:
  - [x] `@jskit-ai/auth-provider-local-db-core`
- [x] Keep `@jskit-ai/auth-provider-local-core` as the provider and service package.
- [x] Make the DB package depend on:
  - [x] `@jskit-ai/auth-provider-local-core`
  - [x] `@jskit-ai/database-runtime`
  - [x] `@jskit-ai/kernel`
- [x] The DB package provides:
  - [x] package-owned migrations
  - [x] database backend implementation
  - [x] backend service provider
- [x] The DB package registers:
  - [x] `auth.local.backend` when `AUTH_LOCAL_BACKEND=db`
- [x] The local provider package still registers the selected `authService`.

Reason: keeping DB storage in a separate package avoids forcing database runtime dependencies into file-backed local auth.

Important provider-ordering requirement:

- [x] The DB package must bind `auth.local.backend` before `AuthLocalServiceProvider.boot()` resolves `authService`.
- [x] `auth-provider-local-core` does not bind the file fallback when `AUTH_LOCAL_BACKEND=db`.
- [x] In DB mode, local auth fails with a direct "install/register the DB backend package" error instead of installing a file fallback factory that later throws.
- [x] This ordering behavior has provider-runtime tests.

## Configuration Contract

- [x] Keep `AUTH_PROVIDER=local`.
- [x] Add documented DB mode:
  - [x] `AUTH_LOCAL_BACKEND=db`
- [x] Keep file mode:
  - [x] `AUTH_LOCAL_BACKEND=file`
- [x] The DB package descriptor sets or updates `AUTH_LOCAL_BACKEND=db` when the package is added intentionally.
- [x] If `AUTH_LOCAL_BACKEND=db` is set without the DB package installed, fail clearly.
- [x] If the DB package is installed but database runtime is missing, fail clearly through provider dependencies.
- [x] Do not silently fall back from DB to file storage in DB mode.
- [x] Do not let both file and DB backends register for `auth.local.backend`; fail loudly on ambiguous registration.
- [x] Custom replacement backends should use a non-`db` backend mode such as `AUTH_LOCAL_BACKEND=custom` or an app-specific value.

## Migration Ownership

- [x] Package-owned migrations means the migration source lives in `auth-provider-local-db-core` and is installed through the normal JSKIT migration mutation flow.
- [x] Installed app migration files should be treated as package artifacts, not app extension points.
- [x] Schema changes after initial release must be additive migrations owned by the package.
- [x] Apps and extension packages should add their own sidecar migrations instead of editing installed local-auth migrations.
- [x] Migrations must be portable across JSKIT's MySQL and Postgres runtimes.
- [x] Avoid dialect-specific defaults and index features in v1.

## Table Ownership

### `auth_local_users`

- [x] Own provider auth identities.
- [x] Suggested columns:
  - [x] `id`
  - [x] `email`
  - [x] `display_name`
  - [x] `password_algorithm`
  - [x] `password_version`
  - [x] `password_salt`
  - [x] `password_hash`
  - [x] `disabled`
  - [x] `created_at`
  - [x] `updated_at`
- [x] Indexes/constraints:
  - [x] unique `email`
- [x] Store `email` as the canonical normalized email returned by the current local auth service.
- [x] Do not add a second email column unless the service starts preserving original casing as a separate product requirement.
- [x] Do not add app profile columns here.

### `auth_local_sessions`

- [x] Own refresh/recovery session records.
- [x] Suggested columns:
  - [x] `id`
  - [x] `user_id`
  - [x] `token_hash`
  - [x] `purpose`
  - [x] `expires_at`
  - [x] `revoked_at`
  - [x] `created_at`
  - [x] `updated_at`
- [x] Indexes/constraints:
  - [x] unique token hash
  - [x] index user id
  - [x] index expiry
  - [x] foreign key to `auth_local_users.id`

### `auth_local_recovery`

- [x] Own password recovery tokens.
- [x] Suggested columns:
  - [x] `id`
  - [x] `user_id`
  - [x] `token_hash`
  - [x] `expires_at`
  - [x] `used_at`
  - [x] `created_at`
  - [x] `updated_at`
- [x] Indexes/constraints:
  - [x] unique token hash
  - [x] index user id
  - [x] index expiry
  - [x] foreign key to `auth_local_users.id`

## Column And Dialect Rules

- [x] Use portable Knex column types compatible with the supported JSKIT database runtimes.
- [x] Use string values for ids, token hashes, algorithms, versions, and session purposes.
- [x] Use nullable timestamp columns for `revoked_at` and `used_at`.
- [x] Keep `purpose` as a string instead of a database enum unless JSKIT already has a cross-dialect enum convention.
- [x] Keep password fields nullable only when a concrete passwordless local-auth mode exists; otherwise require them.
- [x] Never store clear recovery tokens, refresh tokens, or password input.
- [x] Use app/service-managed timestamps instead of dialect-specific `ON UPDATE` behavior.
- [x] Do not use partial indexes in v1.
- [x] Do not use generated columns or JSON column features in v1.
- [x] Do not rely on database enums in v1.

## Backend Contract

- [x] Implement the existing `auth.local.backend` contract.
- [x] Preserve `withTransaction(callback)`.
- [x] Provide transactional repositories:
  - [x] `users`
  - [x] `sessions`
  - [x] `recovery`
- [x] Match the file backend behavior:
  - [x] `users.findByEmail(email)`
  - [x] `users.findById(id)`
  - [x] `users.create(input)`
  - [x] `users.updatePassword(id, password)`
  - [x] `users.updateProfile(id, input)`
  - [x] `sessions.create(input)`
  - [x] `sessions.findById(id)`
  - [x] `sessions.findByTokenHash(tokenHash)`
  - [x] `sessions.revoke(id)`
  - [x] `sessions.revokeForUser(userId, options)`
  - [x] `recovery.create(input)`
  - [x] `recovery.findByTokenHash(tokenHash)`
  - [x] `recovery.consume(id)`
  - [x] `recovery.consumeForUser(userId)`
- [x] Preserve method names and return shapes exactly enough that `createLocalAuthService()` needs no special DB branch.

## Password Strategy Integration

- [x] Keep password hashing/verifying inside local auth service.
- [x] Keep backend persistence-only.
- [x] Store password records in DB columns.
- [x] Convert DB columns to the existing password record shape before returning users:
  - [x] `{ algorithm, version, salt, hash }`
- [x] Convert password record shape back into DB columns on create/update.
- [x] Let `auth.local.passwordStrategy` verify legacy records if apps migrate existing hashes.
- [x] Do not add bcrypt to JSKIT core packages.

## Profile Projection Integration

- [x] Keep `auth.profile.projector` separate from credential storage.
- [x] Keep lazy projector resolution.
- [x] DB local auth creates provider credentials.
- [x] `users-core` creates app-owned users/profile rows only through projection.
- [x] Booting local auth plus DB package plus users-core must not require eager `internal.json-rest-api` resolution.

## Auth Service Decorators And Deferred Events

- [x] Local auth applies the existing `authServiceDecoratorRegistry`.
- [x] Supabase and local auth now share the same auth-service decoration path.
- [x] `createLocalAuthRegisterHookDecorator()` provides simple after-register extension.
- [x] Local register hooks must declare `blocking: true` or `blocking: false`.
- [x] Blocking hook failures reject the register call.
- [x] Non-blocking hook failures are logged and do not reject the register call.
- [x] The register hook runs after local auth registration and profile projection have succeeded.
- [x] The register hook does not share the local auth backend transaction.
- [x] Provider-neutral lifecycle events are not v1 scope unless a concrete first-party consumer is added in the same implementation.
- [x] In v1 docs, say provider-neutral events are deferred and auth service decorators, backend wrappers, plus sidecar-owned routes/jobs are the first extension points.
- [x] Avoid adding pre-commit hooks until there is a concrete use case; pre-commit hooks can make auth behavior hard to reason about.

Future provider-neutral event rules, when that seam is added:

- Events should be provider-neutral local-auth events, not DB-package-only events.
- Events should be implemented in `auth-provider-local-core` so file and DB backends publish the same auth events.
- Events should publish only after the underlying transaction has succeeded.
- Candidate events:
  - `auth.local.user.created`
  - `auth.local.password.changed`
  - `auth.local.recovery.requested`
  - `auth.local.recovery.consumed`
  - `auth.local.session.created`
  - `auth.local.session.revoked`
  - `auth.local.sessions.revokedForUser`
- Event payloads should include stable ids, not password records or clear tokens.
- Events must not publish password hashes, recovery tokens, refresh tokens, or raw secrets.

## Backend Wrappers

- [x] Document that apps/packages can wrap or replace `auth.local.backend`.
- [x] Use wrappers for:
  - [x] audit logging
  - [x] tenant checks
  - [x] observability
  - [x] extra session validation
  - [x] rate-limit counters
  - [x] unusual policy checks
- [x] Wrappers must preserve the backend contract.
- [x] Wrappers must not mutate package-owned table schemas.
- [x] In v1, do not invent a backend wrapper registry.
- [x] If wrapper ordering becomes a real need, add one explicit composition seam later instead of ad hoc token overrides.

## Sidecar Tables

- [x] Document extension tables that reference `auth_local_users.id`.
- [x] Examples:
  - [x] `auth_local_user_audit`
  - [x] `auth_local_login_attempts`
  - [x] `auth_local_mfa_methods`
  - [x] `auth_local_password_history`
- [x] Sidecar tables are owned by the extending package/app.
- [x] In v1, sidecar packages should use backend wrappers or their own routes/jobs.
- [x] Later, sidecar packages can consume lifecycle events if the event seam is added.
- [x] Sidecar packages should not require direct edits to auth-local migrations.
- [x] Sidecar tables are tied to the default DB package schema; replacement backends can define their own extension model.

## Replacement Path

- [x] Keep full replacement through `auth.local.backend`.
- [x] Recommended when apps need:
  - [x] different table names
  - [x] materially different schema
  - [x] external KMS
  - [x] unusual tenancy partitioning
  - [x] legacy auth tables that cannot be adapted cleanly
  - [x] non-SQL credential storage
- [x] Replacement backends must still satisfy the backend contract.

## Implementation Phases

### Phase 1: Contract Audit

- [x] Read `auth-provider-local-core` service and file backend.
- [x] Freeze the backend repository method contract.
- [x] Add contract tests for DB backend against the same repository shape.
- [x] Add provider-ordering tests for `AUTH_LOCAL_BACKEND=db`.
- [x] Confirm password record shape expectations.
- [x] Confirm recovery/session revoke behavior.
- [x] Decide whether `auth-provider-local-core` needs a small fallback-binding change for DB mode.

### Phase 2: Package Scaffold

- [x] Create `packages/auth-provider-local-db-core/`.
- [x] Add `package.json`.
- [x] Add `package.descriptor.mjs`.
- [x] Add server provider entrypoint.
- [x] Add exports for backend factory and provider.
- [x] Add package to workspace/catalog flow.

### Phase 3: Migrations

- [x] Add package-owned migrations for the three tables.
- [x] Use existing JSKIT migration conventions.
- [x] Add foreign keys where supported by current runtime patterns.
- [x] Add indexes/unique constraints.
- [x] Keep migrations app-agnostic.
- [x] Add package descriptor tests that assert migration mutations are present.

### Phase 4: DB Backend

- [x] Implement `createLocalDbBackend({ knex, transactionManager })`.
- [x] Use the existing JSKIT transaction manager where appropriate.
- [x] Implement repository methods cleanly with small local mapping helpers.
- [x] Keep mapping helpers local and minimal.
- [x] Do not duplicate service logic from `auth-provider-local-core`.

### Phase 5: Provider Registration

- [x] Register `auth.local.backend` only when DB mode is selected.
- [x] Register before `AuthLocalServiceProvider.boot()` resolves `authService`.
- [x] Fail if another backend is already registered while `AUTH_LOCAL_BACKEND=db`; DB mode means this package owns the binding.
- [x] Do not override app-provided custom backends unexpectedly.
- [x] Make provider ordering clear in docs.

### Phase 6: Extension Guidance

- [x] Document auth service decorators as the shared service-level extension path.
- [x] Document the local register hook decorator and its required blocking mode.
- [x] Document backend wrappers as the v1 policy/audit/observability extension path.
- [x] Document sidecar-owned tables/routes/jobs as the v1 persistence extension path.
- [x] Explicitly defer provider-neutral lifecycle events unless a concrete first-party consumer is added.
- [x] Do not add a second hook framework or backend wrapper registry in v1.

### Phase 7: Tests

- [x] Reuse backend contract tests for DB backend.
- [x] Test register/login/session read/logout with DB backend.
- [x] Test password recovery request/complete/reset with DB backend.
- [x] Test password change with DB backend.
- [x] Test session revocation and sign-out-other-sessions.
- [x] Test disabled users.
- [x] Test unique canonical email.
- [x] Test `auth.local.passwordStrategy` with DB backend.
- [x] Test profile projection can run with DB backend.
- [x] Test local auth plus DB backend keeps projector resolution lazy.
- [x] Test DB mode does not fall back to file storage.
- [x] Test DB package installation/provider order is deterministic.
- [x] Test the same DB backend contract using portable Knex behavior only.

### Phase 8: Docs

- [x] Add human guide docs for DB-backed local auth.
- [x] Explain the three paths:
  - [x] use it as-is
  - [x] extend around it
  - [x] replace it
- [x] Document tables and ownership.
- [x] Document sidecar table guidance.
- [x] Document local auth service decorators and register-hook blocking semantics.
- [x] Document backend wrapper guidance without promising an unordered wrapper stack.
- [x] Document that provider-neutral lifecycle events are deferred in v1.
- [x] Document password strategy migration examples.
- [x] Document why users-core tables are not credential tables.
- [x] Document provider ordering and `AUTH_LOCAL_BACKEND=db` failure modes.
- [x] Run `npm run agent-docs:build`.
- [x] Review generated agent docs.

### Phase 9: Verification

- [x] Run package tests.
- [x] Run descriptor lint.
- [x] Run catalog build.
- [x] Run agent docs build.
- [x] Run generated reference check.
- [x] Run generated dirty-worktree check and record that it reports the expected regenerated docs/catalog files before commit.
- [x] Run broader workspace tests if the package touches shared contracts.

## Acceptance Criteria

- [x] Adding local auth plus DB local auth package gives working DB-backed register/login/logout without app backend code.
- [x] Password recovery works against DB storage.
- [x] Password changes update DB password fields.
- [x] Sessions are stored, read, refreshed, and revoked through DB tables.
- [x] `auth.local.passwordStrategy` works with DB-backed records.
- [x] `auth.profile.projector` remains lazy.
- [x] users-core projection remains separate from credentials.
- [x] Auth service decorator, sidecar, and backend wrapper extension guidance is documented.
- [x] Local register hook blocking/non-blocking behavior is backed by concrete tests.
- [x] Provider-neutral lifecycle events are explicitly deferred in docs.
- [x] Full backend replacement remains documented and tested at the contract level.
- [x] File backend behavior remains unchanged.
- [x] `AUTH_LOCAL_BACKEND=db` cannot accidentally use file storage.
- [x] Provider ordering is covered by tests, not just documentation.
- [x] The schema and backend use only portable MySQL/Postgres Knex behavior.

## Explicitly Not Doing

- [x] Do not migrate arbitrary app users automatically.
- [x] Do not add bcrypt as a JSKIT dependency.
- [x] Do not build MFA in the core DB backend.
- [x] Do not build login attempt/rate limit tables into the base schema unless there is a concrete first-party policy.
- [x] Do not build provider-neutral lifecycle events in v1 without a concrete first-party consumer.
- [x] Do not build a second hook registry or backend wrapper registry in v1.
- [x] Do not build cleanup jobs in v1.
- [x] Do not add dialect-specific indexes, generated columns, database enums, or `ON UPDATE` timestamp behavior in v1.
- [x] Do not mutate users-core schemas for credential storage.
- [x] Do not make migrations configurable by app-specific table names in the default package.
