# @jskit-ai/auth-provider-supabase-core

Supabase-backed auth provider service used by JSKit auth flows.

## What this package is for

Use this package when your app wants a production-ready auth provider built on Supabase.

It handles account lifecycle and session security details such as:

- register/login/logout
- OTP login
- OAuth login and account linking
- password reset and password change
- security checks for cookies and sessions

## Provider catalog ownership

This package owns the Supabase OAuth provider catalog and metadata.

It can resolve providers from:

- `oauthProviderCatalog` (explicit list of `{ id, label, queryParams? }`)
- `oauthProviders` (id list, for example `"google,github"`)
- `oauthDefaultProvider`
- `oauthProviderLabels` (label overrides)
- `oauthProviderQueryParams` (provider-specific query param overrides)

If nothing is configured, it defaults to a safe Supabase catalog baseline (`google`).

## Public API

## `createService(deps)`

Creates the auth provider service.

Key config fields (from `deps.authProvider` and legacy top-level aliases):

- `id` (`supabase`)
- `supabaseUrl`
- `supabasePublishableKey`
- `jwtAudience`
- `oauthProviderCatalog`
- `oauthProviders`
- `oauthDefaultProvider`
- `oauthProviderLabels`
- `oauthProviderQueryParams`

Returned methods:

- `register(input)`
- `login(input)`
- `requestOtpLogin(input)`
- `verifyOtpLogin(input)`
- `oauthStart(input)`
- `oauthComplete(input)`
- `startProviderLink(input)`
- `requestPasswordReset(input)`
- `completePasswordRecovery(input)`
- `resetPassword(input)`
- `updateDisplayName(input)`
- `changePassword(input)`
- `setPasswordSignInEnabled(input)`
- `unlinkProvider(input)`
- `signOutOtherSessions(input)`
- `getSecurityStatus(input)`
- `getSettingsProfileAuthInfo(input)`
- `getOAuthProviderCatalog()`
  - Returns `{ providers: [{ id, label }], defaultProvider }` for UI and adapter session payloads.
- `authenticateRequest(input)`
- `hasAccessTokenCookie(request)`
- `hasSessionCookie(request)`
- `writeSessionCookies(reply, session)`
- `clearSessionCookies(reply)`

## `__testables`

Exports internal helpers used by tests.

## Provider runtime (new path)

- `AuthSupabaseServiceProvider` is exported for provider/kernel runtime boot.
- In `register()`, it binds:
  - `authService`
  - `actionRegistry`
  - `actionExecutor`
- It reads environment inputs from `TOKENS.Env` when present.

## How apps use this package

Typical flow:

1. App creates this service at server startup with Supabase credentials and OAuth catalog config.
2. Auth adapter/controller calls service methods per endpoint.
3. Service talks to Supabase and normalizes responses.
4. Session/auth payloads include provider catalog metadata for frontend method rendering.

Why apps use it:

- centralizes tricky auth edge cases
- standardizes cookie/session behavior
- keeps HTTP layer and domain layer simpler
- keeps provider vocabulary and labels in the provider package (not in framework core)
