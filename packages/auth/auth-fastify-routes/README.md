# @jskit-ai/auth-fastify-routes

Fastify HTTP adapter for authentication endpoints.

## What this package is for

Use this package to expose auth features over HTTP (register, login, logout, password reset, OTP, OAuth callbacks).

This package is the transport layer. Transport layer means "HTTP request/response wiring". It does not own database logic or third-party auth logic.

## Key terms (plain language)

- `Fastify`: a Node.js web server framework.
- `controller`: code that converts HTTP requests into service calls.
- `schema`: request/response validation contract.
- `OAuth`: sign-in with providers like Google or GitHub.
- `OTP`: one-time password/code, usually emailed.

## Public API

## `createController(deps)`

Builds HTTP handlers. Returned handler functions:

- `register`
  - Creates a new account.
  - Real example: user fills signup form with email + password.
- `login`
  - Signs in with credentials.
  - Real example: user logs in from web login page.
- `requestOtpLogin`
  - Sends an OTP login code.
  - Real example: passwordless "email me a code" button.
- `verifyOtpLogin`
  - Verifies OTP and creates session.
  - Real example: user enters 6-digit code from inbox.
- `oauthStart`
  - Starts provider sign-in flow.
  - Real example: redirect to Google auth screen.
- `oauthComplete`
  - Handles provider callback and finalizes sign-in.
  - Real example: after Google redirects back to your app.
- `logout`
  - Clears current session.
  - Real example: user clicks "Sign out".
- `session`
  - Returns current auth session/user summary.
  - Real example: frontend checks if user is already logged in.
- `requestPasswordReset`
  - Starts password reset flow.
  - Real example: forgot-password form sends reset email.
- `completePasswordRecovery`
  - Completes recovery after token/code verification.
  - Real example: user opens recovery link and confirms identity.
- `resetPassword`
  - Sets new password.
  - Real example: user chooses new password after recovery.

## `buildRoutes(controller, options)`

Returns route definitions for auth endpoints.

Real example: server boot calls this once, then registers all auth routes in Fastify.

Why apps use it:

- one shared route contract across apps
- consistent endpoint names and policies

## `schema`

Exports request/response schemas used by the routes.

Real example: invalid payload (missing email) is rejected early with clear validation errors.

Why apps use it:

- keeps API docs and runtime behavior aligned
- reduces controller boilerplate

## How apps use this package (and why)

Typical flow:

1. App creates auth core/provider service.
2. App calls `createController({ authService, ... })`.
3. App builds routes with `buildRoutes`.
4. Fastify receives requests and controller delegates to service.

Why this split matters:

- easier testing (controller tests vs service tests)
- easier provider swapping (Supabase today, other provider later)
