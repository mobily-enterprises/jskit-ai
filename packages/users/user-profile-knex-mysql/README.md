# @jskit-ai/user-profile-knex-mysql

Knex/MySQL repository for user profile persistence.

## What this package is for

Use this package to store and query user profile data in MySQL:

- find profiles by id/email/provider identity
- upsert profile rows from auth identity
- update/clear avatar fields
- update display name

## Key terms (plain language)

- `upsert`: update if row exists, otherwise insert.
- `duplicate entry`: DB unique-constraint conflict (for example two rows with same unique email).

## Exports

- `@jskit-ai/user-profile-knex-mysql`
- `@jskit-ai/user-profile-knex-mysql/repositories/profile`

Public runtime API:

- `createRepository(dbClient)`

`__testables` is for tests.

## Function reference

### `createRepository(dbClient)`

Creates a profiles repository backed by `user_profiles` table.

Returned methods:

- `findById(userId)`
  - returns mapped profile or `null`.
  - Real-life example: load current user profile for settings page.

- `findByEmail(email)`
  - case-insensitive email lookup.
  - Real-life example: check if invite email already has a profile.

- `findByIdentity({ provider, providerUserId })`
  - lookup by auth provider identity.
  - Real-life example: OAuth callback resolves user by provider identity.

- `updateDisplayNameById(userId, displayName)`
  - updates and returns row.
  - Real-life example: user changes display name in profile settings.

- `updateAvatarById(userId, avatarPatch)`
  - updates avatar storage key/version/timestamp.
  - Real-life example: after successful avatar upload processing.

- `clearAvatarById(userId)`
  - clears avatar columns and returns row.
  - Real-life example: user removes custom avatar and falls back to Gravatar.

- `upsert(profileLike)`
  - validates identity/email/displayName
  - inserts or updates profile atomically in transaction
  - converts duplicate email conflicts to explicit error code `USER_PROFILE_EMAIL_CONFLICT`

  Real-life example: first login creates profile; later logins refresh email/displayName.

## Practical usage example

```js
import { createRepository as createUserProfilesRepository } from "@jskit-ai/user-profile-knex-mysql";

const userProfilesRepository = createUserProfilesRepository(knex);

const profile = await userProfilesRepository.upsert({
  authProvider: "supabase",
  authProviderUserId: "auth_user_123",
  email: "user@example.com",
  displayName: "Casey"
});
```

## How `jskit-value-app` uses it and why

Real usage:

- `apps/jskit-value-app/server/runtime/repositories.js`
- `apps/jskit-value-app/tests/repositoriesBehavior.test.js`
- `apps/jskit-value-app/tests/edgeCases.test.js`

Why:

- one shared repository guarantees consistent identity/email conflict behavior
- avatar/profile updates use the same date mapping and row mapping logic

## Non-goals

- no auth-token/session handling
- no avatar file storage (handled by `@jskit-ai/user-profile-core`)
- no HTTP route logic
