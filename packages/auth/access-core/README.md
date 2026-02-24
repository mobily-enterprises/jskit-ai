# @jskit-ai/access-core

Core authentication and access helpers shared across server and client code.

## What this package is for

Use this package for reusable auth and access primitives:

- auth field constraints (email, password, token sizes)
- supported sign-in methods (password, email otp, oauth)
- oauth provider and callback param normalization
- input validation for register/login/reset flows
- invite token generation and hashing
- membership access normalization helpers

The goal is to keep auth rules in one place so app code does not duplicate validation and normalization logic.

## What this package is not for

- No database access.
- No HTTP routing.
- No UI components.
- No app-specific permission policy decisions.

## Exports

- `@jskit-ai/access-core`
- `@jskit-ai/access-core/authConstraints`
- `@jskit-ai/access-core/authMethods`
- `@jskit-ai/access-core/oauthProviders`
- `@jskit-ai/access-core/oauthCallbackParams`
- `@jskit-ai/access-core/utils`
- `@jskit-ai/access-core/validators`
- `@jskit-ai/access-core/inviteTokens`
- `@jskit-ai/access-core/membershipAccess`

## Function and constant reference

### `authConstraints`

These are constants used by schema and validation layers.

- `AUTH_EMAIL_PATTERN`, `AUTH_EMAIL_REGEX`: email format checks.
- `AUTH_EMAIL_MIN_LENGTH`, `AUTH_EMAIL_MAX_LENGTH`: accepted email length range.
- `AUTH_PASSWORD_MIN_LENGTH`, `AUTH_PASSWORD_MAX_LENGTH`: registration password limits.
- `AUTH_LOGIN_PASSWORD_MAX_LENGTH`: login input max guard.
- `AUTH_RECOVERY_TOKEN_MAX_LENGTH`, `AUTH_ACCESS_TOKEN_MAX_LENGTH`, `AUTH_REFRESH_TOKEN_MAX_LENGTH`: token length guards.

Real-life example:

- If a user pastes a 20,000-character token in a form, schemas can reject it early using these constants.

### `authMethods`

- `buildOAuthMethodId(provider)`
  - Builds canonical ids like `oauth:google`.
  - Example: settings page stores enabled method ids as strings; this keeps provider ids consistent.
- `parseAuthMethodId(value)`
  - Parses and normalizes values like `password`, `email_otp`, `oauth:google`.
  - Example: admin API receives `" OAuth:Google "` and converts it to normalized `oauth:google`.
- `findAuthMethodDefinition(methodId)`
  - Returns method metadata (`kind`, `provider`, label, secret-update support), or `null`.
  - Example: security settings view looks up label and whether password change is allowed.

Related constants:

- ids: `AUTH_METHOD_PASSWORD_ID`, `AUTH_METHOD_EMAIL_OTP_ID`
- providers: `AUTH_METHOD_PASSWORD_PROVIDER`, `AUTH_METHOD_EMAIL_OTP_PROVIDER`
- kinds: `AUTH_METHOD_KIND_PASSWORD`, `AUTH_METHOD_KIND_OTP`, `AUTH_METHOD_KIND_OAUTH`, `AUTH_METHOD_KINDS`
- defaults: `AUTH_METHOD_MINIMUM_ENABLED`, `AUTH_METHOD_DEFINITIONS`, `AUTH_METHOD_IDS`

### `oauthProviders`

- `normalizeOAuthProvider(value, { fallback })`
  - Canonicalizes provider input and applies fallback.
  - Example: callback receives `Google` and normalizes to `google`.
- `isSupportedOAuthProvider(value)`
  - Returns true only for known providers.
  - Example: reject unknown provider query params before redirecting to oauth.

Related constants:

- `AUTH_OAUTH_PROVIDER_METADATA`
- `AUTH_OAUTH_PROVIDERS`
- `AUTH_OAUTH_DEFAULT_PROVIDER`

### `oauthCallbackParams`

Constants for callback URL query keys:

- `OAUTH_QUERY_PARAM_PROVIDER`
- `OAUTH_QUERY_PARAM_INTENT`
- `OAUTH_QUERY_PARAM_RETURN_TO`

Real-life example:

- OAuth callback parser and OAuth URL builder use the same key names to avoid mismatched query params.

### `utils`

- `normalizeEmail(value)`
  - Trims and lowercases.
  - Example: ` User@Example.com ` becomes `user@example.com` before login lookup.
- `normalizeOAuthIntent(value, { fallback })`
  - Normalizes intent to `login` or `link`.
  - Example: callback with `oauthIntent=LINK` becomes `link`.
- `normalizeReturnToPath(value, { fallback })`
  - Accepts safe local paths only (starts with `/`, rejects `//`).
  - Example: prevents open redirect from `https://evil.com` and falls back to `/`.

### `validators`

`validators` is an object with these functions:

- `validators.email(rawEmail)`
  - Returns `""` if valid, otherwise message.
  - Example: live form validation while user types.
- `validators.registerPassword(rawPassword)`
  - Registration password rules.
  - Example: enforce 8 to 128 chars on sign-up.
- `validators.loginPassword(rawPassword)`
  - Login password rules with high max length guard.
  - Example: avoid overly large payload attacks on login.
- `validators.resetPassword(rawPassword)`
  - Reset password rules (same policy as register).
  - Example: reset-password form rejects short passwords before submit.
- `validators.confirmPassword({ password, confirmPassword })`
  - Confirms match.
  - Example: prevent accidental mismatch before submit.
- `validators.registerInput(payload)`
  - Returns normalized `{ email, password, fieldErrors }`.
  - Example: server parser can read normalized values directly.
- `validators.loginInput(payload)`
  - Returns normalized login input and field errors.
  - Example: API handler can consume `{ email, password, fieldErrors }` directly.
- `validators.forgotPasswordInput(payload)`
  - Validates email-only payload.
  - Example: forgot-password endpoint gets cleaned email and consistent field errors.
- `validators.resetPasswordInput(payload)`
  - Validates reset form password payload.
  - Example: reset endpoint receives validated password and predictable error shape.

### `inviteTokens`

- `normalizeInviteToken(token)`
  - Trims token input.
  - Example: remove whitespace copied from email.
- `isSha256Hex(value)`
  - Checks if value looks like a sha256 hex string.
  - Example: detect whether stored token hash format is valid.
- `buildInviteToken()`
  - Creates a random invite token.
  - Example: generate token for workspace invite email.
- `hashInviteToken(token)`
  - Hashes token with sha256.
  - Example: store only hash in database, never raw token.
- `encodeInviteTokenHash(tokenHash)`
  - Adds opaque prefix `inviteh_` to a valid hash.
  - Example: expose token references in API without leaking raw token.
- `resolveInviteTokenHash(inviteToken)`
  - Accepts either raw token or prefixed hash and resolves to hash.
  - Example: invite acceptance endpoint accepts both formats during migration.

Related constant:

- `OPAQUE_INVITE_TOKEN_HASH_PREFIX`

### `membershipAccess`

- `resolveMembershipRoleId(membershipLike)`
  - Extracts normalized role id string.
  - Example: membership row has `roleId`, service reads it safely.
- `resolveMembershipStatus(membershipLike)`
  - Resolves status with fallback to `active`.
  - Example: handles objects using either `status` or `membershipStatus`.
- `normalizeMembershipForAccess(membershipLike)`
  - Returns `{ roleId, status }` only for active memberships, else `null`.
  - Example: inactive memberships are ignored in permission checks.
- `mapMembershipSummary(membershipLike)`
  - Alias of access normalization for summary mapping.
  - Example: workspace list serializer reuses the same active-membership filter logic.
- `normalizePermissions(value)`
  - Deduplicates and trims permission lists.
  - Example: turns `["read", " read ", "", "read"]` into `["read"]`.
- `createMembershipIndexes(memberships)`
  - Builds `Map` indexes by workspace id and slug.
  - Example: quickly find membership by slug during request routing.

## How it is used in apps (real terms, and why)

Current `jskit-value-app` usage:

- Auth wrappers re-export this package:
  - `apps/jskit-value-app/shared/auth/authConstraints.js`
  - `apps/jskit-value-app/shared/auth/authMethods.js`
  - `apps/jskit-value-app/shared/auth/oauthProviders.js`
  - `apps/jskit-value-app/shared/auth/oauthCallbackParams.js`
  - `apps/jskit-value-app/shared/auth/utils.js`
  - `apps/jskit-value-app/shared/auth/validators.js`
- Invite token wrappers re-export this package:
  - `apps/jskit-value-app/server/domain/console/policies/inviteTokens.js`
  - `apps/jskit-value-app/server/domain/workspace/policies/inviteTokens.js`

Why this matters:

- login/register/reset forms and server parsers apply identical validation rules
- oauth flows use one canonical provider and callback normalization path
- invite token generation/hashing is consistent across workspace and console domains

Practical flow example:

1. User submits login form with mixed-case email.
2. `normalizeEmail` canonicalizes it.
3. `validators.loginInput` returns field errors or clean input.
4. Server auth service uses the same normalized values.
