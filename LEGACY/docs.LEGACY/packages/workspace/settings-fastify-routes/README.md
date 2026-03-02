# @jskit-ai/settings-fastify-routes

Fastify adapter for user settings/profile/security endpoints.

## What this package is for

Use this package to expose user self-service settings APIs, including profile updates, avatar upload, notification preferences, chat preferences, and security actions.

## Key terms (plain language)

- `self-service`: the logged-in user manages their own account settings.
- `upload policy`: size/type constraints for uploaded files.
- `OAuth provider link`: connecting third-party login (Google/GitHub) to account.

## Public API

## `createController(deps)`

Creates settings controller handlers.

Returned handlers:

- `get`
  - Returns current settings payload.
  - Real example: settings page initial load.
- `updateProfile`
  - Updates profile fields.
  - Real example: change display name and timezone.
- `updatePreferences`
  - Updates general preferences.
  - Real example: set language or date format preferences.
- `updateNotifications`
  - Updates notification settings.
  - Real example: turn off marketing emails.
- `updateChat`
  - Updates chat-specific settings.
  - Real example: set compact message density.
- `uploadAvatar`
  - Uploads user avatar image.
  - Real example: user uploads profile photo from settings UI.
- `deleteAvatar`
  - Removes avatar.
  - Real example: revert to initials avatar.
- `changePassword`
  - Changes password for logged-in user.
  - Real example: periodic password rotation.
- `setPasswordMethodEnabled`
  - Enables/disables password sign-in policy where allowed.
  - Real example: user switches to OAuth-only sign-in.
- `startOAuthProviderLink`
  - Starts OAuth provider linking flow.
  - Real example: link GitHub account in security tab.
- `unlinkOAuthProvider`
  - Removes linked provider.
  - Real example: disconnect old Google account.
- `logoutOtherSessions`
  - Logs out other devices.
  - Real example: user lost laptop and ends other sessions.

## `buildRoutes(controller, options)`

Builds Fastify route definitions for settings endpoints.

Real example: routes under `/api/settings` for profile/preferences/security operations.

## `schema`

Exports settings route schemas.

Real example: avatar upload payload/response validation stays consistent.

## `normalizeAvatarUploadPolicy(policy)`

Normalizes/validates avatar upload constraints.

Real example: app config sets max file size, function resolves defaults safely.

## `DEFAULT_AVATAR_UPLOAD_POLICY`

Default avatar constraints used when app does not override upload policy.

Real example: keeps avatar feature safe even with minimal config.

## How apps use this package (and why)

Typical flow:

1. App creates settings/profile/auth services.
2. Adapter controller combines them into HTTP handlers.
3. Fastify registers settings routes and schemas.

Why apps use it:

- complete self-service account API without per-app duplication
- consistent security-sensitive behavior (password/provider/session actions)

## Provider runtime (new path)

- `SettingsRouteServiceProvider` is exported for provider/kernel runtime boot.
- Required container bindings:
  - `authService`
  - `actionExecutor`
