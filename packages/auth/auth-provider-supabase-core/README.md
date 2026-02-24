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

## Key terms (plain language)

- `Supabase`: managed backend that includes auth APIs.
- `session cookie`: browser cookie proving logged-in state.
- `access token`: credential used to call authenticated APIs.
- `provider linking`: connecting Google/GitHub login to an existing user account.

## Public API

## `createService(deps)`

Creates the auth provider service.

Returned methods:

- `register(input)`
  - Creates a new user account.
  - Real example: first-time signup from email/password form.
- `login(input)`
  - Signs in and issues session cookies.
  - Real example: standard sign-in page.
- `requestOtpLogin(input)`
  - Sends OTP login challenge.
  - Real example: passwordless login for users who forgot password.
- `verifyOtpLogin(input)`
  - Verifies OTP and establishes session.
  - Real example: user pastes one-time code from email.
- `oauthStart(input)`
  - Builds provider redirect URL.
  - Real example: "Continue with Google".
- `oauthComplete(input)`
  - Exchanges callback data and finalizes login.
  - Real example: auth callback endpoint after provider redirect.
- `startProviderLink(input)`
  - Starts linking a new OAuth provider to an existing account.
  - Real example: user links GitHub in account settings.
- `requestPasswordReset(input)`
  - Sends reset instructions.
  - Real example: forgot-password page.
- `completePasswordRecovery(input)`
  - Completes recovery state after link/code verification.
  - Real example: recovery page confirms token validity.
- `resetPassword(input)`
  - Sets new password for recovery flow.
  - Real example: user submits new password in reset form.
- `updateDisplayName(input)`
  - Updates profile display name.
  - Real example: account settings "Name" field.
- `changePassword(input)`
  - Changes password for logged-in user.
  - Real example: security settings panel.
- `setPasswordSignInEnabled(input)`
  - Enables/disables password sign-in mode when policy allows.
  - Real example: enterprise account switches to OAuth-only sign-in.
- `unlinkProvider(input)`
  - Removes linked OAuth provider.
  - Real example: user disconnects GitHub account.
- `signOutOtherSessions(input)`
  - Invalidates sessions on other devices.
  - Real example: user clicks "Log out of all other devices" after suspicious activity.
- `getSecurityStatus(input)`
  - Returns current security posture summary.
  - Real example: settings page shows whether password and providers are configured.
- `getSettingsProfileAuthInfo(input)`
  - Returns auth details needed by profile/settings screens.
  - Real example: frontend needs linked providers list.
- `authenticateRequest(input)`
  - Validates request auth from cookies/tokens.
  - Real example: middleware checks if incoming request has valid session.
- `hasAccessTokenCookie(request)`
  - Checks if access-token cookie exists.
  - Real example: short-circuit unauthenticated requests.
- `hasSessionCookie(request)`
  - Checks if session cookie exists.
  - Real example: detect likely logged-in browser state.
- `writeSessionCookies(reply, session)`
  - Writes auth cookies to HTTP response.
  - Real example: after successful login.
- `clearSessionCookies(reply)`
  - Clears auth cookies.
  - Real example: logout endpoint.

## `__testables`

Exports internal helpers used by tests.

Real example: unit tests verify edge-case behavior without hitting Supabase directly.

## How apps use this package (and why)

Typical flow:

1. App creates this service during server startup.
2. Auth adapter/controller calls service methods per endpoint.
3. Service talks to Supabase and normalizes responses.
4. App gets consistent auth outcomes regardless of flow type.

Why apps use it:

- centralizes tricky auth edge cases
- standardizes cookie/session behavior
- keeps HTTP layer and domain layer simpler
