# Provider-Neutral Auth Layer Plan

## Problem

The current auth path presents a generic `auth.provider` capability, but the only real provider implementation is Supabase. The first app therefore requires a Supabase project, Supabase URL configuration, and Supabase keys before a user can experience login.

That is the wrong default. The first app should have a working local login with no database and no external auth service.

## Target Outcome

Create a provider-neutral auth layer with a first-class local provider that is simple, strong, and honest:

- default provider for the first auth app is local, not Supabase
- default local backend is `file`
- no database is required for register, login, logout, session refresh, or password recovery
- recovery sends email through SMTP when SMTP env is configured
- recovery has an explicit non-production developer path when SMTP is not configured
- Supabase remains available as an opt-in provider package
- `auth.provider` becomes a real selected-provider contract, not a Supabase alias
- `auth-core` owns the provider-neutral API that local, Supabase, and future providers implement
- JSKIT docs recommend keeping authentication deliberately basic until the app's main product flows are built, then adding OTP, OAuth, provider linking, Supabase, users DB projection, or workspace/account complexity only when the app actually needs them

## Architecture

### Package Boundaries

Use these boundaries:

- `@jskit-ai/auth-core`
  - Owns provider-neutral auth contracts.
  - Owns the complete `authService` interface.
  - Owns standard auth action contributors.
  - Owns auth session event service registration.
  - Owns shared commands, paths, validators, provider capability schema, normalized actor shape, and normalized security-status shape.
  - Exports the provider capability normalizer and unsupported-operation error helpers.
  - Exports optional profile projection contracts for apps that install a users/profile DB layer.

- `@jskit-ai/auth-web`
  - Owns routes and login UI.
  - Renders modes from provider capabilities.
  - Talks only to auth-core routes/actions/contracts.
  - Does not assume Supabase, OAuth, OTP, or password recovery are available.

- `@jskit-ai/auth-provider-local-core`
  - New provider package.
  - Provides `auth.provider.local`.
  - Provides `auth.provider` only as the selected app provider.
  - Implements the auth-core `authService` contract using local storage.
  - Registers local file backend by default.

- `@jskit-ai/auth-provider-supabase-core`
  - Remains Supabase-specific.
  - Provides `auth.provider.supabase`.
  - Provides `auth.provider` only as the selected app provider.
  - Implements the same auth-core `authService` contract using Supabase Auth.
  - No longer owns generic auth actions.

### Provider Selection And Conflicts

`auth.provider` means exactly one selected auth provider is active for the app.

Concrete providers use concrete capabilities:

```text
auth.provider.local
auth.provider.supabase
```

The selected provider also satisfies the generic capability:

```text
auth.provider
```

Rules:

- normal `jskit add` flows allow only one selected provider package in the auth provider conflict group
- `jskit add` must refuse installing `auth-provider-local-core` and `auth-provider-supabase-core` together unless an explicit provider-switch or migration mode is used
- migration mode may allow multiple concrete provider packages to be installed temporarily, but only one selected-provider bridge may register `auth.provider` and `authService`
- runtime must fail fast if multiple providers attempt to register `authService`
- runtime must fail fast if `AUTH_PROVIDER` does not match the installed provider
- provider packages must never silently no-op and let another provider win by registration order

This keeps `auth.provider` as a real selected-provider contract instead of another vague alias.

### Auth-Core Service Contract

Define the provider-neutral `authService` surface in `auth-core` from day 0. Providers implement the required core and may implement optional account-management features. Unsupported provider features return the shared unsupported-operation error and must be reflected in capabilities.

Required core:

```js
{
  getCapabilities(),
  authenticateRequest(request),
  hasAccessTokenCookie(request),
  hasSessionCookie(request),
  writeSessionCookies(reply, session),
  clearSessionCookies(reply),

  logout(request)
}
```

Optional feature surface:

```js
{
  register(input),
  resendRegisterConfirmation(input),
  login(input),
  requestOtpLogin(input),
  verifyOtpLogin(input),
  oauthStart(input),
  oauthComplete(input),

  requestPasswordReset(input),
  completePasswordRecovery(input),
  resetPassword(request, input),
  changePassword(request, input),

  updateDisplayName(request, input),
  getSecurityStatus(request),
  setPasswordSignInEnabled(request, input),
  startProviderLink(request, input),
  unlinkProvider(request, input),
  signOutOtherSessions(request)
}
```

Rules:

- local, Supabase, and future providers implement this contract directly
- provider storage adapters are below this contract, not part of it
- `auth.local.backend` is only the local provider's storage extension point
- Supabase does not use `auth.local.backend`
- provider-specific SDK/API details must not leak into `auth-web`
- all optional methods are capability-gated and covered by unsupported-operation tests
- optional feature descriptors should be the source used to validate or derive capability output, so a provider cannot claim support for methods it has not implemented
- `auth-web` and routes call optional methods only after capabilities say they are supported

### Normalized Actor And Optional Profiles

Separate auth identity from app user storage.

There are three layers:

```text
1. Provider identity/session store
2. Auth-core normalized actor
3. Optional app user/profile projection
```

Provider identity/session store is required by the active provider:

- local without DB: file backend stores credentials, sessions, recovery tokens, and identity fields
- Supabase without DB: Supabase Auth stores credentials, sessions, recovery, OTP, OAuth, and identity fields
- future providers use their own identity/session stores

Auth-core normalized actor is always available and must not require a DB:

```js
{
  authenticated: true,
  actor: {
    authIdentityId: "local:usr_123",
    provider: "local",
    providerUserId: "usr_123",
    email: "ada@example.com",
    displayName: "Ada",
    appUserId: null,
    profileSource: "auth-provider"
  },
  permissions: []
}
```

Optional app user/profile projection is enabled only when a users/profile package is installed:

```text
provider identity -> auth.profile.projector -> app user/profile
```

With projection, the actor may include an app-owned user id:

```js
{
  authenticated: true,
  actor: {
    authIdentityId: "supabase:abc",
    provider: "supabase",
    providerUserId: "abc",
    email: "ada@example.com",
    displayName: "Ada",
    appUserId: "42",
    profileSource: "users"
  },
  permissions: []
}
```

Rules:

- auth must work when `auth.profile.projector` is absent
- `users.profile.sync.service` must not be required for base auth
- no standalone in-memory app profile mirror for production-like behavior
- profile projection stores app-owned profile/settings/workspace data, not provider credentials
- profile projection errors must be explicit; they must not silently downgrade to fake in-memory users
- during migration, `authenticateRequest()` should return both normalized `actor` and a legacy-compatible `profile` projection because existing packages expect `authResult.profile.id/displayName/email`
- legacy `profile` should be derived from `actor` or projected app profile, not from a separate in-memory profile mirror

### Security Status Contract

Define normalized security status in `auth-core` so Supabase and local can both report account state without leaking provider details.

Initial shape:

```js
{
  authMethods: [
    {
      id: "password",
      kind: "password",
      configured: true,
      enabled: true,
      canDisable: false
    },
    {
      id: "oauth:google",
      kind: "oauth",
      provider: "google",
      configured: true,
      enabled: true,
      canUnlink: true
    }
  ],
  policy: {
    minimumEnabledMethods: 1
  },
  actions: {
    changePassword: true,
    setPasswordEnabled: false,
    linkProvider: true,
    unlinkProvider: true,
    signOutOtherSessions: true
  }
}
```

Local maps this from local password/session records. Supabase maps this from Supabase identities, password state, OAuth providers, and session APIs.

### Session And Cookie Contract

Own browser session mechanics in `auth-core`; provider packages supply provider-specific token/session material behind the same cookie policy.

Cookie rules:

- auth cookies are `HttpOnly`
- production auth cookies are `Secure`
- `SameSite` must be explicit and compatible with OAuth/recovery redirects
- cookie path/domain scoping must be explicit and app-configurable only through documented options
- access, refresh, and recovery-session cookies have distinct names or a strongly typed session purpose
- recovery reset endpoints must reject normal sessions when a recovery-scoped session is required
- CSRF expectations must be explicit for cookie-authenticated mutating routes

Session rules:

- access tokens include a `sessionId` and `jti` or equivalent session identifier
- authenticated request resolution checks backend session state, unless the provider explicitly documents short-lived JWT residual validity
- logout revokes the current refresh session and invalidates future backend session checks
- `signOutOtherSessions` revokes every other refresh session for the actor and defines the residual behavior of already-issued access tokens
- refresh tokens are opaque random tokens; only hashes are stored
- refresh rotation and reuse detection should be implemented for local auth if feasible, and unsupported rotation must be explicitly documented
- password reset revokes existing normal sessions for that actor
- recovery-scoped sessions are short-lived and are cleared after password reset

### Capability Contract

Add a provider capability payload returned by `authService.getCapabilities()` and surfaced through `GET /api/session`.

Initial shape:

```js
{
  provider: {
    id: "local",
    label: "Local"
  },
  features: {
    password: {
      login: true,
      register: true,
      change: true,
      methodToggle: false
    },
    passwordRecovery: {
      request: true,
      complete: true,
      delivery: "smtp" // "smtp", "dev-log", "dev-response", "disabled"
    },
    otp: {
      login: false
    },
    oauthLogin: {
      enabled: false,
      providers: [],
      defaultProvider: null
    },
    emailConfirmation: false,
    profileUpdate: true,
    providerLinking: {
      start: false,
      unlink: false
    },
    securityStatus: true,
    signOutOtherSessions: true,
    appProfileProjection: false
  }
}
```

Rules:

- UI only renders modes that are supported.
- API routes may remain registered, but unsupported operations return the shared unsupported-operation error.
- `authService` method behavior must match `getCapabilities()`.
- capability output must cover every optional `authService` operation.
- Metadata must match runtime behavior.
- No silent fallback may claim recovery email was sent when neither SMTP nor dev recovery output is active.
- Tests must cover capability output and unsupported-operation behavior for every provider.

## Local Provider

### Config

Use env and app config without requiring setup for local development.

Recommended env:

```bash
AUTH_PROVIDER=local
AUTH_LOCAL_BACKEND=file
AUTH_LOCAL_STORE_DIR=.jskit/auth
AUTH_LOCAL_SESSION_SECRET=
AUTH_LOCAL_FILE_PRODUCTION_ACK=
AUTH_LOCAL_SMTP_HOST=
AUTH_LOCAL_SMTP_PORT=
AUTH_LOCAL_SMTP_SECURE=
AUTH_LOCAL_SMTP_USER=
AUTH_LOCAL_SMTP_PASSWORD=
AUTH_LOCAL_SMTP_FROM=
AUTH_LOCAL_SMTP_REPLY_TO=
AUTH_LOCAL_RECOVERY_DEV_OUTPUT=log
```

Defaults:

- `AUTH_LOCAL_BACKEND=file`
- `AUTH_LOCAL_STORE_DIR=.jskit/auth`
- `AUTH_LOCAL_RECOVERY_DEV_OUTPUT=log` outside production
- production requires `AUTH_LOCAL_SESSION_SECRET`
- production with file backend requires `AUTH_LOCAL_FILE_PRODUCTION_ACK`
- non-production may generate and persist `.jskit/auth/session.secret`

The generated `.jskit/auth/` directory is runtime state and must be gitignored by the package mutation.

### Backend Interface

Create a small public backend interface so file is the default, but DB can be adapted later without replacing or forking the provider.

Register it under:

```text
auth.local.backend
```

The local provider should resolve `auth.local.backend` when present and otherwise install the built-in file backend.

Backend contract:

```js
{
  withTransaction(async (tx) => {
    await tx.users.create(input);
    await tx.users.findById(userId);
    await tx.users.findByEmail(email);
    await tx.users.updatePassword(userId, passwordRecord);

    await tx.sessions.create(input);
    await tx.sessions.findByTokenHash(tokenHash);
    await tx.sessions.revoke(sessionId);
    await tx.sessions.revokeForUser(userId);

    await tx.recovery.create(input);
    await tx.recovery.findByTokenHash(tokenHash);
    await tx.recovery.consume(tokenId);
  })
}
```

Rules:

- multi-record operations go through one transaction
- password reset is one transaction across recovery token, user password, and sessions
- register is one transaction across user and session creation
- logout is one transaction across session lookup and revocation
- the public backend test suite must be reusable by custom DB backend implementations
- keep the backend interface in the local provider package until another local backend package exists; export it from the package so app code can implement it without copying internals

### File Backend

Use a line-oriented, passwd-like file backend.

Support boundary:

- supported by default for local development and first-app demos
- supported in production only for single-node deployments with a persistent writable volume, explicit production acknowledgment, configured session secret, and backup guidance
- not supported for serverless read-only filesystems, ephemeral containers, multi-replica deployments, or shared filesystems where locking semantics are unclear
- production startup must fail fast when file backend constraints are not acknowledged
- docs must tell users when to move from file backend to a DB/custom backend

Requirements:

- one user record per line
- deterministic record versioning
- no plaintext passwords
- stable parse and stable write order
- atomic write through temp file plus rename
- read-modify-write protected by a lock file
- strict file permissions where supported
- no dependency on a database
- clear corruption errors; do not skip bad records silently

Use sidecar files for session and recovery records:

```text
.jskit/auth/users.passwd
.jskit/auth/sessions.passwd
.jskit/auth/recovery.passwd
.jskit/auth/session.secret
```

Record formats should include an explicit version and algorithm marker. Example direction:

```text
user:v1:<userId>:<email>:<displayNameBase64url>:scrypt:v1:<saltBase64url>:<hashBase64url>:<createdAt>:<updatedAt>:<disabled>
session:v1:<sessionId>:<userId>:<refreshTokenHashBase64url>:<createdAt>:<expiresAt>:<revokedAt>
recovery:v1:<tokenId>:<userId>:<tokenHashBase64url>:<createdAt>:<expiresAt>:<usedAt>
```

Use base64url for fields that may contain unsafe delimiter characters.

Transaction behavior:

- use one lock for the whole `.jskit/auth/` store, not one lock per file
- read all touched files under that lock
- validate all touched records before applying changes
- write touched files to temp files, fsync where practical, then rename
- keep record ordering stable by record type and id
- if a commit fails midway, the next read must either recover cleanly or fail loudly with a repairable corruption error

### Password Hashing

Use Node built-in crypto first:

- `crypto.scrypt`
- random per-password salt
- constant-time hash comparison
- algorithm and parameter version stored in the file

This avoids making first login depend on a native password-hashing package. If stronger packaged hashing is desired later, add it as a versioned hash algorithm migration, not as a first-pass requirement.

### Sessions

Use provider-owned cookies, not Supabase cookie names.

Recommended cookies:

```text
jskit_local_access_token
jskit_local_refresh_token
```

Session model:

- access token: short-lived signed JWT
- refresh token: opaque random token, hash stored in backend
- logout revokes refresh token and clears cookies
- session read refreshes access token when refresh token is still valid
- password reset revokes existing refresh sessions for that user
- recovery completion creates a short-lived recovery-scoped session
- password reset accepts only a recovery-scoped session or an already-authenticated normal session, then clears the recovery session

Production must fail fast without an explicit session secret. Non-production may create a local runtime secret file and log that it was created.

### Register

Local register should:

- normalize email
- reject duplicate email
- hash password
- create provider identity with display fields
- create app profile rows only through `auth.profile.projector` when installed
- create a session
- return normalized actor plus legacy-compatible profile/session shape expected by current `auth-web`
- not require email confirmation in v1

### Password Recovery

Local recovery must be complete, not just request-only.

Flow:

1. User submits email.
2. Provider creates a one-time recovery token if the email exists.
3. Provider sends or exposes a recovery URL.
4. User opens the recovery URL.
5. Web UI exchanges the recovery token for a short-lived recovery-scoped session.
6. Web UI lets the user set a new password.
7. Provider consumes token, updates password, revokes existing normal sessions, and clears recovery session state.

SMTP behavior:

- if SMTP env is configured, send email
- use `nodemailer` as the provider-local SMTP implementation
- require `AUTH_LOCAL_SMTP_FROM`
- build recovery URL from `APP_PUBLIC_URL`
- startup/config validation must fail when SMTP recovery is enabled but `APP_PUBLIC_URL` cannot produce a valid public recovery URL
- include only the raw token in the email URL; store only a token hash

No SMTP behavior:

- production: recovery capability is disabled and API returns configuration error if called
- non-production with `AUTH_LOCAL_RECOVERY_DEV_OUTPUT=log`: create token and log the recovery URL
- non-production with `AUTH_LOCAL_RECOVERY_DEV_OUTPUT=response`: return the recovery URL in the response for tests and demos
- no hidden fallback

Abuse and privacy rules:

- public password-reset request responses must be uniform for existing and missing emails
- recovery tokens have explicit TTL defaults
- recovery token verification is single-use
- rate limiting must support at least per-email and per-IP throttles
- logs must not include raw recovery tokens unless non-production dev output explicitly asks for it

### Reset UI

Extend `auth-web` because the existing login view only requests reset instructions.

Add a dedicated `/auth/reset-password` route so the login view does not grow another large mode. The route should:

- read recovery token params
- call `POST /api/password/recovery`
- show new-password and confirm-password fields
- call `POST /api/password/reset`
- redirect to login after success

Keep the implementation provider-neutral so Supabase recovery can use it later too.

## Supabase Provider Over The Contract

Supabase should be a provider implementation of the auth-core contract, not a special auth architecture.

The existing `@jskit-ai/auth-provider-supabase-core` must be redone around this structure, not patched as the hidden owner of generic auth behavior. Its implementation should keep Supabase-specific SDK calls, error mapping, OAuth/OTP/recovery mapping, and cookie/token translation, but remove or relocate anything that belongs to `auth-core` or optional app profile projection.

Required Supabase package changes:

- replace the old Supabase-owned generic provider ambiguity with a selected-provider bridge:
  - the concrete provider package provides `auth.provider.supabase`
  - the selected-provider bridge registers provider id `auth.provider` only when Supabase is the selected installed provider
  - CLI/catalog capability checks still enforce that normal installs have exactly one `auth.provider` provider
- stop owning generic auth action contributors
- stop requiring `users.profile.sync.service` for base auth
- replace standalone in-memory profile sync with normalized `actor` plus optional `auth.profile.projector`
- report capabilities from Supabase/app config instead of hard-coded UI assumptions
- preserve existing public package id and env vars where possible

Mapping rules:

- `register()` maps to Supabase sign-up and normalizes the resulting user into the auth-core actor shape.
- `login()` maps to Supabase password sign-in.
- `authenticateRequest()` verifies Supabase access/refresh tokens and returns a normalized actor.
- `requestOtpLogin()` and `verifyOtpLogin()` map to Supabase OTP flows and are capability-enabled only when configured.
- `oauthStart()` and `oauthComplete()` map to Supabase OAuth flows and expose provider buttons through capabilities.
- `startProviderLink()` and `unlinkProvider()` map to Supabase identity linking/unlinking.
- `requestPasswordReset()`, `completePasswordRecovery()`, and `resetPassword()` map to Supabase recovery while preserving the shared two-step recovery-session contract at the JSKIT boundary.
- `getSecurityStatus()` maps Supabase identities/password state/session APIs into the auth-core normalized security status.
- `getCapabilities()` reports the exact Supabase features enabled by app config and provider configuration.

Supabase without a JSKIT database must still work:

- actor comes from Supabase user claims/API
- `appUserId` is `null`
- `profileSource` is `"auth-provider"`
- no `users.profile.sync.service` is required

Supabase with a JSKIT users/profile DB uses the optional projection layer:

```text
Supabase user -> auth.profile.projector -> app user/profile
```

The projection layer may create or update app-owned profile rows, but Supabase remains the credential/session/recovery source of truth.

## Auth-Core Refactor

Move these out of `auth-provider-supabase-core`:

- standard auth action contributor
- `baseAuthActions`
- `buildAuthActions`

Add an `AuthActionsServiceProvider` in `auth-core`.

Rules:

- `AuthActionsServiceProvider.dependsOn = ["runtime.actions"]` at provider-runtime level so `auth-core` remains provider-neutral plumbing and can boot without a selected provider
- the registered actions depend on `authService` and `auth.session.events.service`
- `auth-web` and auth bundles require `auth.provider` through package capability closure when browser/server auth routes are installed
- provider packages register `authService`
- `auth-core` registers standard actions against the active `authService`
- `auth-core` owns `auth.session.events.service`
- `auth-core` owns normalized actor, capability, security-status, and unsupported-operation helpers
- session event publication remains optional for actions that do not change session state
- `devLoginAsAction` stays provider-specific unless a future generic dev auth contract is designed

This prevents Supabase from being the owner of generic auth behavior.

## Auth-Web Changes

Update `GET /api/session` output to include provider capabilities.

Update default login state to:

- fetch session/capabilities before showing unavailable modes
- hide Register when unsupported
- hide Forgot password when unsupported
- hide OTP when unsupported
- hide OAuth buttons unless OAuth providers are configured
- hide provider-linking and security actions unless supported
- keep password login as the simple default for local provider

Unsupported actions should not appear in the UI.

Add `/auth/reset-password` as a provider-neutral route. It should exchange recovery params for a recovery-scoped session, submit the new password, clear recovery cookies, and return the user to `/auth/login`.

## CLI And Catalog

Add package descriptor for `@jskit-ai/auth-provider-local-core`.

Add a convenience bundle:

```text
auth-local
```

Bundle contents:

```text
@jskit-ai/auth-core
@jskit-ai/auth-provider-local-core
@jskit-ai/auth-web
```

Change first-app auth guidance:

- `create-app --initial-bundles auth` installs or prints `npx jskit add bundle auth-local`
- docs should start with local auth
- Supabase docs become an upgrade/provider swap chapter

The first auth install should be possible without collecting provider keys.

## Product Guidance

By the end of this implementation, JSKIT should recommend a low-friction auth path in generated output and docs:

- start with local password auth
- keep authentication boring while building the actual app
- avoid adding Supabase, OAuth, OTP, provider linking, account security pages, users DB projection, or workspace/account complexity before the core app flow exists
- add richer auth features later through provider capabilities and optional packages
- present Supabase as an upgrade or deployment choice, not the default first-app requirement

This guidance should appear in the human guide, generated agent docs, and create-app/auth install messaging.

## Database Runtime Impact

This auth redesign removes the database requirement from first-app authentication. It does not remove JSKIT's general database runtime or database driver packages.

Keep these packages for app data, CRUDs, users, workspaces, console, assistant/runtime persistence, and generated database-backed features:

```text
@jskit-ai/database-runtime
@jskit-ai/database-runtime-mysql
@jskit-ai/database-runtime-postgres
```

What changes:

- first-app auth must not require `database-runtime-mysql` or `database-runtime-postgres`
- local auth's default `file` backend is not a wrapper around JSKIT database runtime
- custom local DB auth backends may use JSKIT database runtime, but that is an app choice through `auth.local.backend`
- users/profile DB projection may use JSKIT database runtime, but it remains optional and separate from base auth
- docs must stop implying that installing database runtime automatically fixes auth profile storage

If future auth-specific DB backend packages are introduced, they should be optional adapters for `auth.local.backend`, not part of the first-app path.

## Migration And Compatibility

Do not break existing Supabase apps.

Rules:

- Supabase package keeps its current public package id.
- Existing Supabase env vars continue to work.
- Existing `auth-base` bundle can remain provider-neutral.
- New `auth-local` bundle is the low-friction first-app path.
- provider conflict checks prevent accidentally selecting local and Supabase providers together.
- explicit provider-switch or migration mode may install multiple concrete provider packages temporarily, but must still expose one selected `auth.provider`.
- provider-switch documentation must tell users how to remove or migrate the previous provider.
- authentication results expose legacy `profile` during migration while new code moves to normalized `actor`.
- Generated docs must clearly distinguish local default auth from Supabase auth.

## Verification

Add focused tests before broad docs updates.

Required tests:

- auth-core validates and normalizes provider capabilities
- auth-core validates normalized actor and security-status shapes
- every optional authService method has a shared unsupported-operation path
- optional feature descriptors cannot claim unsupported methods
- session/cookie policy sets HttpOnly, Secure-in-production, explicit SameSite, explicit max ages, and typed recovery-session behavior
- access-token `sessionId`/`jti` backend checks invalidate logged-out sessions as designed
- refresh-token rotation/reuse behavior is tested or explicitly marked unsupported
- local auth works without `auth.profile.projector`
- Supabase auth works without `auth.profile.projector`
- optional profile projection adds `appUserId` without becoming required for auth
- projection failures are explicit and do not fall back to fake in-memory app users
- legacy `profile` projection remains available during actor migration
- local file backend fails fast in unsupported production configurations
- local file backend accepts production only with explicit acknowledgment and persistent-store configuration
- local file backend creates, reads, updates, and rejects duplicate users
- password hashes are not plaintext and verify correctly
- corrupt passwd records fail loudly
- file writes are stable and deterministic
- file backend transaction covers password reset across recovery, users, and sessions
- custom backend fixture passes the public backend contract tests
- register returns active session
- login succeeds and fails correctly
- session read authenticates access token
- session read refreshes from refresh token
- logout revokes refresh token and clears cookies
- password recovery disabled in production without SMTP
- password recovery returns uniform public responses for existing and missing emails
- password recovery enforces token TTL and per-email/per-IP throttling hooks
- password recovery validates `APP_PUBLIC_URL` when SMTP delivery is enabled
- password recovery logs or returns dev URL only outside production
- SMTP recovery sends through configured transport
- recovery token is single-use and expires
- password reset revokes old sessions
- recovery completion creates only a recovery-scoped session
- provider conflict checks reject multiple selected providers in the same app
- provider-switch migration mode still exposes exactly one selected `auth.provider`
- `auth-core` action provider registers actions once against the active provider
- Supabase provider implements the auth-core contract without owning generic actions
- Supabase provider reports OTP, OAuth, linking, recovery, and security-status capabilities accurately
- auth-web hides unsupported modes from local provider
- auth-web shows supported Supabase OTP/OAuth/linking/security flows only when capabilities allow them
- auth-web reset flow completes recovery
- create-app auth preset no longer mentions Supabase
- create-app auth preset does not install or require database driver packages
- human guide and generated agent docs recommend starting with basic local auth and adding richer auth later
- Supabase provider still passes existing tests

Commands to run during implementation:

```bash
npm test --workspace @jskit-ai/auth-core
npm test --workspace @jskit-ai/auth-web
npm test --workspace @jskit-ai/auth-provider-supabase-core
npm test --workspace @jskit-ai/auth-provider-local-core
npm test --workspace @jskit-ai/create-app
npm run agent-docs:build
```

Then run the repo-level verification if the focused tests are green:

```bash
npm run verify
```

## Implementation Order

1. Define the full `authService` contract in `auth-core`.
2. Split required core from optional feature descriptors and capability validation.
3. Add normalized capability, actor, and security-status schemas to `auth-core`.
4. Add shared unsupported-operation helpers and tests.
5. Add auth-core cookie/session policy helpers, typed session purpose, and CSRF expectations.
6. Add optional `auth.profile.projector` contract without making it required for auth.
7. Add legacy `profile` compatibility projection during actor migration.
8. Add provider conflict metadata, install/runtime conflict checks, and explicit provider-switch mode.
9. Move generic auth action contributor and session events from Supabase provider to `auth-core`.
10. Update Supabase provider to consume the shared actions, implement the auth-core contract, and report capabilities.
11. Remove any base-auth requirement for `users.profile.sync.service`; route app-user persistence through optional projection.
12. Add local provider package with public backend contract tests first.
13. Add in-memory local backend fixture for service tests.
14. Add file backend production boundary checks, store-level transactions, and passwd-like records.
15. Add local session tokens, provider-owned cookies, backend session checks, and recovery-scoped sessions.
16. Add local register/login/logout/session support.
17. Add local recovery token backend with TTL, uniform response, throttling hooks, and URL config validation.
18. Add SMTP/dev recovery delivery.
19. Add `/auth/reset-password` UI in `auth-web`.
20. Make `auth-web` capability-driven across password, OTP, OAuth, linking, recovery, and security status.
21. Add `auth-local` bundle and catalog entries.
22. Update `create-app --initial-bundles auth`.
23. Update human guide and generated agent docs.
24. Run focused tests, then full verification.

## Rejected Approaches

- Making Supabase env optional: this leaves the runtime Supabase-specific and only hides the symptom.
- Using `AUTH_DEV_BYPASS_ENABLED` as first-app auth: it is localhost-only, profile-dependent, and not a product login.
- Requiring SQLite/Postgres for local auth: that reintroduces database friction.
- Shipping a DB backend in v1 local auth: the public backend interface should make DB support easy later, but file auth should land cleanly first.
- Keeping auth actions inside the Supabase package: that preserves the current contract drift.
- Pretending recovery email was sent without SMTP: this creates support issues and violates capability metadata.
- Requiring `users.profile.sync.service` for base auth: that makes the optional app database look mandatory and recreates the current broken standalone-profile behavior.
- Recreating standalone in-memory app profiles: provider identity is enough without DB; app-owned profiles belong behind an explicit projection layer.
- Treating the file backend as horizontally scalable production infrastructure: file auth is a low-friction local/single-node backend, not a substitute for a replicated identity store.
- Relying on stateless JWT access tokens for immediate logout semantics without documenting residual validity or checking backend session state.

## Open Decisions

- Confirm the exact provider-switch UX for apps that already have Supabase installed.
- Decide whether local auth requires backend session checks on every authenticated request or accepts very short residual access-token validity.
