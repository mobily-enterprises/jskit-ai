# @jskit-ai/access-core

Core authentication and access helpers shared across server and client code.

## What this package is for

Use this package for reusable auth and access primitives:

- auth field constraints (email, password, token sizes)
- auth method identifiers and parsing (`password`, `email_otp`, `oauth:<providerId>`)
- generic OAuth provider id normalization and validation
- callback query key constants
- input validation for register/login/reset flows
- invite token generation and hashing
- membership access normalization helpers

The goal is to keep auth rules in one place so app code does not duplicate validation and normalization logic.

## What this package is not for

- No database access.
- No HTTP routing.
- No provider-specific OAuth catalogs (that belongs to provider packages).
- No UI components.
- No app-specific permission policy decisions.

## Exports

- `@jskit-ai/access-core/server`
- `@jskit-ai/access-core/server/authConstraints`
- `@jskit-ai/access-core/server/authMethods`
- `@jskit-ai/access-core/server/oauthProviders`
- `@jskit-ai/access-core/server/oauthCallbackParams`
- `@jskit-ai/access-core/server/utils`
- `@jskit-ai/access-core/server/validators`
- `@jskit-ai/access-core/server/inviteTokens`
- `@jskit-ai/access-core/server/membershipAccess`
- `@jskit-ai/access-core/client`
- `@jskit-ai/access-core/client/authApi`
- `@jskit-ai/access-core/client/signOutFlow`

## Function and constant reference

### `authConstraints`

Constants used by schema and validation layers.

- `AUTH_EMAIL_PATTERN`, `AUTH_EMAIL_REGEX`: email format checks.
- `AUTH_EMAIL_MIN_LENGTH`, `AUTH_EMAIL_MAX_LENGTH`: accepted email length range.
- `AUTH_PASSWORD_MIN_LENGTH`, `AUTH_PASSWORD_MAX_LENGTH`: registration password limits.
- `AUTH_LOGIN_PASSWORD_MAX_LENGTH`: login input max guard.
- `AUTH_RECOVERY_TOKEN_MAX_LENGTH`, `AUTH_ACCESS_TOKEN_MAX_LENGTH`, `AUTH_REFRESH_TOKEN_MAX_LENGTH`: token length guards.

### `authMethods`

- `buildOAuthMethodId(providerId)`
  - Builds canonical ids like `oauth:google`.
- `parseAuthMethodId(value)`
  - Parses and normalizes values like `password`, `email_otp`, `oauth:github`.
- `buildOAuthMethodDefinitions(oauthProviders)`
  - Builds OAuth method definitions from provider ids or `{ id, label }` entries.
- `buildAuthMethodDefinitions({ oauthProviders })`
  - Returns base auth methods plus OAuth methods built from catalog input.
- `buildAuthMethodIds({ oauthProviders })`
  - Returns method ids from the built definitions.
- `findAuthMethodDefinition(methodId, { oauthProviders })`
  - Returns method metadata (`kind`, `provider`, label, secret-update support), or `null`.

Related constants:

- ids: `AUTH_METHOD_PASSWORD_ID`, `AUTH_METHOD_EMAIL_OTP_ID`
- providers: `AUTH_METHOD_PASSWORD_PROVIDER`, `AUTH_METHOD_EMAIL_OTP_PROVIDER`
- kinds: `AUTH_METHOD_KIND_PASSWORD`, `AUTH_METHOD_KIND_OTP`, `AUTH_METHOD_KIND_OAUTH`, `AUTH_METHOD_KINDS`
- defaults: `AUTH_METHOD_MINIMUM_ENABLED`, `AUTH_METHOD_DEFINITIONS`, `AUTH_METHOD_IDS`

Notes:

- `AUTH_METHOD_DEFINITIONS` and `AUTH_METHOD_IDS` include only base methods (`password`, `email_otp`).
- OAuth method definitions are runtime-built from provider catalogs supplied by provider packages.

### `oauthProviders`

- `OAUTH_PROVIDER_ID_PATTERN`, `OAUTH_PROVIDER_ID_REGEX`
  - Canonical provider id rule (`^[a-z0-9][a-z0-9_-]{1,31}$`).
- `normalizeOAuthProviderId(value, { fallback })`
  - Normalizes a provider id and applies fallback if valid.
- `isValidOAuthProviderId(value)`
  - Boolean validation helper for provider ids.
- `normalizeOAuthProviderList(value, { fallback })`
  - Normalizes provider lists from array/string input and removes duplicates.

Important:

- This module does not ship provider metadata lists (labels/icons/query params).
- Provider catalogs belong to provider packages (for example Supabase provider module).

### `oauthCallbackParams`

Constants for callback URL query keys:

- `OAUTH_QUERY_PARAM_PROVIDER`
- `OAUTH_QUERY_PARAM_INTENT`
- `OAUTH_QUERY_PARAM_RETURN_TO`

### `utils`

- `normalizeEmail(value)`
  - Trims and lowercases.
- `normalizeOAuthIntent(value, { fallback })`
  - Normalizes intent to `login` or `link`.
- `normalizeReturnToPath(value, { fallback })`
  - Accepts safe local paths only (starts with `/`, rejects `//`).

### `validators`

`validators` is an object with these functions:

- `validators.email(rawEmail)`
- `validators.registerPassword(rawPassword)`
- `validators.loginPassword(rawPassword)`
- `validators.resetPassword(rawPassword)`
- `validators.confirmPassword({ password, confirmPassword })`
- `validators.registerInput(payload)`
- `validators.loginInput(payload)`
- `validators.forgotPasswordInput(payload)`
- `validators.resetPasswordInput(payload)`

### `inviteTokens`

- `normalizeInviteToken(token)`
- `isSha256Hex(value)`
- `buildInviteToken()`
- `hashInviteToken(token)`
- `encodeInviteTokenHash(tokenHash)`
- `resolveInviteTokenHash(inviteToken)`

Related constant:

- `OPAQUE_INVITE_TOKEN_HASH_PREFIX`

### `membershipAccess`

- `resolveMembershipRoleId(membershipLike)`
- `resolveMembershipStatus(membershipLike)`
- `normalizeMembershipForAccess(membershipLike)`
- `mapMembershipSummary(membershipLike)`
- `normalizePermissions(value)`
- `createMembershipIndexes(memberships)`

## How it is used in apps

Current `jskit-value-app` examples:

- Server auth parsers and flows:
  - `apps/jskit-value-app/server/modules/auth/lib/authInputParsers.js`
  - `apps/jskit-value-app/server/modules/auth/lib/authRedirectUrls.js`
  - `apps/jskit-value-app/server/modules/auth/lib/authMethodStatus.js`
- Client auth flows:
  - `apps/jskit-value-app/src/modules/auth/oauthProviders.js`
  - `apps/jskit-value-app/src/modules/auth/oauthCallback.js`
  - `apps/jskit-value-app/src/views/settings/security/useSettingsSecurityForm.js`
- App/router/runtime auth helpers:
  - `apps/jskit-value-app/src/app/router/guards.js`
  - `apps/jskit-value-app/src/framework/moduleRegistry.base.js`
  - `apps/jskit-value-app/server/surfaces/appSurface.js`

Why this matters:

- login/register/reset forms and server parsers apply identical validation rules
- OAuth method ids stay canonical across server and client
- provider-specific catalogs remain outside framework core
- invite token generation/hashing is consistent across workspace and console domains
