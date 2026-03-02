# @jskit-ai/user-profile-core

User profile avatar and identity primitives for server-side apps.

## What this package is for

Use this package to handle profile avatar workflows consistently:

- upload and process user avatars
- store avatar files on disk
- build public avatar URLs
- resolve stable profile identity keys (`authProvider + authProviderUserId`)

## Key terms (plain language)

- `avatar policy`: limits and allowed formats for uploaded avatars.
- `profile identity`: provider-based unique key for a user (for example `google + providerUserId`).
- `gravatar`: fallback avatar URL generated from email hash.

## Exports

- `@jskit-ai/user-profile-core` (exports `resolveProfileIdentity`)
- `@jskit-ai/user-profile-core/avatarService`
- `@jskit-ai/user-profile-core/avatarStorageService`
- `@jskit-ai/user-profile-core/profileIdentity`

Public runtime API:

- `resolveProfileIdentity(profileLike)`
- `createService(...)` from `avatarService`
- `createService(...)` from `avatarStorageService`

`__testables` exports are for tests only.

## Function reference

### `resolveProfileIdentity(profileLike)`

Normalizes and returns:

- `{ provider, providerUserId }` when valid
- `null` when missing/invalid fields

Practical example:

- after OAuth callback, build a stable identity key before profile lookup/upsert.

### `avatarStorageService.createService(options)`

Creates storage service for avatar files.

Returns methods:

- `init()`
  - Creates storage directory.
- `registerDelivery(app, { fastifyStatic, decorateReply })`
  - Registers Fastify static file serving for avatar URLs.
- `toPublicUrl(storageKey, avatarVersion)`
  - Converts internal storage key to public URL (optionally versioned with `?v=`).
- `saveAvatar({ userId, buffer, avatarVersion })`
  - Writes avatar bytes and returns storage info.
- `deleteAvatar(storageKey)`
  - Deletes stored avatar file.

Practical example:

- app startup calls `registerDelivery(...)` so `/uploads/avatars/...` serves user images.

### `avatarService.createService({ userProfilesRepository, avatarStorageService, avatarPolicy })`

Creates avatar business service.

Returns methods:

- `uploadForUser(user, payload)`
  - validates mime type and file size
  - resizes/crops/converts image to WebP via `sharp`
  - saves bytes through `avatarStorageService`
  - updates profile avatar columns in repository
  - returns updated profile + image metadata

  Real-life example: user uploads PNG profile photo from settings page.

- `clearForUser(user)`
  - resolves user profile identity, deletes stored file if present, clears avatar columns.
  - Real-life example: user clicks "Remove avatar".

- `buildAvatarResponse(profile, { avatarSize })`
  - builds `uploadedUrl`, `gravatarUrl`, `effectiveUrl`, `hasUploadedAvatar`, `size`, `version`.
  - Real-life example: bootstrap response needs one URL to show immediately in header UI.

## Practical usage example

```js
import { createService as createAvatarStorageService } from "@jskit-ai/user-profile-core/avatarStorageService";
import { createService as createAvatarService } from "@jskit-ai/user-profile-core/avatarService";

const avatarStorageService = createAvatarStorageService({
  driver: "fs",
  rootDir: process.cwd(),
  publicBasePath: "/uploads"
});

await avatarStorageService.init();

const avatarService = createAvatarService({
  userProfilesRepository,
  avatarStorageService
});
```

## How `jskit-value-app` uses it and why

Real usage:

- `apps/jskit-value-app/server/runtime/services.js`
- `apps/jskit-value-app/server/modules/settings/service.js`
- `apps/jskit-value-app/tests/avatarStorageService.test.js`
- `apps/jskit-value-app/tests/userAvatarService.test.js`

Why:

- file storage concerns are separated from image processing and profile persistence
- every avatar response shape is consistent across endpoints
- identity normalization logic is shared by settings/profile flows

## Non-goals

- no direct SQL access (repository injected)
- no authentication implementation
- no CDN/image-proxy integrations
