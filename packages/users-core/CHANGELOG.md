# Changelog

## Unreleased

- The `users/user-administration-server` pattern's `workspaceMembersOnly` reads the workspace's members with only the list's context and transaction (`passedOn(options)`): the list's own settings, such as `format: "jsonapi"`, no longer reach `workspaces.memberships`.
- The user settings table's fields with a default (theme, locale, time zone, date and number formats, currency, avatar size, and the password and notification flags) are no longer `required`, which `defineTableResource` now refuses beside `defaultTo`: a create that leaves one out gets its default where it failed REQUIRED. The CRUD and API contracts keep their own body and output schemas, so requests are unchanged.
- `@jskit-ai/database-runtime` and `@jskit-ai/resource-runtime` are peer dependencies, required and at the same versions, where they were dependencies: its user settings are a table resource and its profiles live in the database, and the app holds one copy of the table runtime that every package shares, as it does the kernel. npm installs a required peer as it installed the dependency, so an app installs the same packages and versions; a release whose versions disagree now fails the install with ERESOLVE instead of nesting a second copy.
- **Security.** The `users/user-administration-server` pattern's workspace variant narrows its repository to the reads it narrows: `workspaceMembersOnly` answers only `query`, `get` and `pageLimits`, where it passed users.profiles' other methods (`findByEmail`, `countUsers`, the writes) through un-narrowed to anything that required the feature's capability.
- `@jskit-ai/users-core/server/UsersExtensionsProvider` exports `UsersExtensionsProvider`, which provides `users.extensions`, so a test can start `UsersIdentityProvider` (`users.profiles`, `users.settings`) beside its own features with `startTestFeatures`.
- **Breaking.** The users table resource drops its scalar `id` search entry, which made `filters: { id: ids }` fail, and its `ids` entry: `filters: { id }` takes one id or a list. The settings table drops `search: true` on its `id` field. `countUsers` and the `users/user-administration-server` pattern's workspace narrowing filter by `id`. **Upgrading:** `filters: { ids }` on `users.profiles` becomes `filters: { id: ids }`.
- The `users/user-administration-server` pattern's packages require `crud.contracts`, which every package with a CRUD feature now lists.
- The `users/user-administration-server` pattern's users list and view answer only the display name, email, username and timestamps its CRUD contract names: before, the CRUD service also answered the sign-in identity and the avatar's storage, which the contract kept out of its output with `{}` entries. Applications that copied the pattern get the same by upgrading crud-core, and drop the `{}` entries.
- The `users/user-administration-server` pattern's workspace variant lists only the workspace's active members: its `decorateRepository` (`src/server/workspaceMembersOnly.js`) narrows users-core's repository with `workspaces.memberships`' `activeMemberIds`, and anyone else is a missing record. Before, the `users` table being public, a workspace admin's list showed every user with an account. An application that copied the variant copies the narrowing.
- `users.profiles` gains what an application moving its own users table onto users-core needs, each joining the caller's transaction: `createWithId(profile, options)` creates a profile with the id it is given (an application that keeps the ids of its earlier users table; on PostgreSQL, advance the id sequence after such an import); `listByEmails(emails, options)` answers the profiles of a set of emails in one read, through the users table resource's new `emails` filter (`in`); `createManyIgnoringExisting(profiles, options)` creates, in one INSERT per chunk, the profiles whose identity has none and leaves the others as they are, answering the new ids, and runs only in a system context; `changeUsername(userId, username, options)` refuses a username another profile holds with `USER_PROFILE_USERNAME_CONFLICT` before writing, so the caller's transaction goes on; and `countUsers` takes `authProvider`, counting the users of one sign-in provider.
- The users table resource reads in display-name order, then email (`defaultSort: ["displayName", "email"]`), so a users list keeps the order it had before it moved onto users-core's resource.
- **Breaking (data-access redesign).** `UsersIdentityProvider` owns the `users` and `user_settings` tables through `defineFeature({ owns })` and reads and writes them through their resource handles, instead of registering them on `runtime.json-rest-api`; it requires `runtime.resources` and `runtime.actions`. `users.profiles`, `users.settings` and `auth.profile.projector` keep their methods and answers. Their `withTransaction(options, work)` runs `work(txOptions)` in the caller's transaction or in one it opens, and every call inside passes `txOptions` on. `users.profiles` also exposes the reads `query`, `get` and `pageLimits`, for a CRUD feature that names it as its `ownerRepository`, and no handle writes. Behaviour difference: a display name or avatar update of a missing profile answers `null` outside a transaction, instead of failing with json-rest-api's 404.
- **Breaking (data-access redesign).** Each users table is one table resource: `userProfileTableResource` (name `userProfiles`, table `users`) and `userSettingsTableResource` (name `userSettings`, table `user_settings`), registered under their names, from the same module paths (`./shared/resources/userProfileResource` and `./shared/resources/userSettingsResource`); a name ending in `TableResource` is a table resource, one ending in `Contract` or `Crud` a contract on it. The HTTP operations are API contracts: `userProfileContract` (patch, avatarUpload, avatarDelete) and `userSettingsContract` (view, preferencesUpdate, notificationsUpdate, passwordChange, passwordMethodToggle, oauthLinkStart, oauthUnlink, logoutOtherSessions). The account CRUD operations are CRUD contracts on those table resources, with the operations, bodies, outputs and messages they had: `userProfileCrud` and `userSettingsCrud` (view, list, create, replace and patch, under the namespaces `userProfile` and `userSettings`; no JSKIT route serves them). The users table resource gains the `q` filter: every word in the display name, email or username. The user-administration pattern's examples build their CRUD contract, `userCrud`, on `userProfileTableResource` instead of a second table resource on `users`.
- The profile projector's `syncIdentityProfile` takes `onlyWhenChanged`: an existing profile that already matches the identity (email, display name, provider identity) is answered after one read, without opening a transaction, ensuring user settings or running the lifecycle contributors (workspaces' personal workspace provisioning); a missing or changed profile is synchronized in full. JSKIT's auth providers pass it on ordinary requests and synchronize in full at sign-in and session refresh. Visible difference: a personal workspace, owner membership or user settings row deleted while its person is signed in is re-created at their next sign-in or session refresh instead of their next request; a name or email changed at the provider still shows at the next request.
- A new profile's username (the email's local part, or the requested name, then `name-2` to `name-1000`) is chosen with one read of every taken candidate through the profile resource's new `usernames` filter (`in`), instead of one read per taken candidate, so a common name costs the same statements after 10 namesakes as after 200. The chosen name, the trimming of long names, the profile's own name counting as free and the error when all 1,000 are taken are unchanged.
- The account security routes' declared rate limits apply, now that the kernel enforces route limits.
- The settings, security and avatar field messages are sent in the coded form `{ code, message, params }`, so their field errors translate. The English is unchanged.
- The resources' validation feedback names the catalog key `jskit.users.feedback.validationFailed` instead of plain English; JSKIT's forms render it with `text()`, so the English shown is unchanged.
- `USER_PROFILE_EMAIL_CONFLICT` has its English in the catalog, so it translates.
- **Breaking (data-access redesign).** The users' records are their owners' capabilities: `users.profiles` (the `users` table: `findById`, `findByEmail`, `findByIdentity`, `upsert`, the display name and avatar updates, `createWithSettings` and `countUsers`) and `users.settings` (the `user_settings` table: `findByUserId`, `ensureForUserId` and the settings updates). `UsersIdentityProvider` provides them, with `auth.profile.projector`, instead of `users.identity`, and `users.core` no longer has `repositories`; its types are `UsersProfiles` and `UsersSettings`.
- New `createWithSettings({ profile, settings }, options)` on `users.profiles` creates a profile (or, for an identity that has one, updates it, as `upsert` does) and gives it its settings in one transaction, the caller's `options.trx` or its own: the settings start from the defaults and the given fields replace them, and the call answers `{ profile, settings }`.
- New `countUsers({ excludeIds, createdSince }, options)` on `users.profiles` counts the users with one aggregate read, or two when `excludeIds` is given (json-rest-api 2.4 has no "not in" filter, so the excluded users who match are counted and subtracted). The profile resource gains the filters it uses: `ids` (`id in [...]`) and `createdSince` (`created_at >=`).

### Upgrading

- A feature that required `identity: "users.identity"` requires `users.profiles`, `users.settings` and, for the projector, `auth.profile.projector`: `identity.repositories.userProfiles` becomes the `users.profiles` capability and `identity.repositories.userSettings` becomes `users.settings`. Code that read `repositories.userProfiles` or `repositories.userSettings` of `users.core` requires them the same way. The `UsersIdentity` type is gone; use `UsersProfiles` and `UsersSettings`.
- Tests that run `UsersIdentityProvider.setup()` read `{ profiles, settings, profileProjector }` from its result, and pass `{ extensions, actionCatalogue, resourceRuntime }` (for example `createTestResourceRuntime({ knex })` of `@jskit-ai/resource-runtime/test`) instead of `jsonRestApi`.
- `profiles.withTransaction(async (trx) => …)` with `{ trx }` passed inside becomes `profiles.withTransaction(options, async (txOptions) => …)` with `txOptions` passed inside, and the same for `settings.withTransaction`. A raw Knex transaction is refused by the handles' writes; join the caller's managed one by passing its options.

### New codes (17)

<details><summary>Code list</summary>

- `USER_PROFILE_EMAIL_CONFLICT`
- `users.avatar.streamMissing`
- `users.avatar.mimeTypeInvalid`
- `users.avatar.fileNameInvalid`
- `users.avatar.uploadDimensionInvalid`
- `users.security.currentPasswordInvalid`
- `users.security.newPasswordRequired`
- `users.security.newPasswordMinLength`
- `users.security.confirmPasswordRequired`
- `users.security.enabledRequired`
- `users.security.enabledInvalid`
- `users.security.oauthProviderRequired`
- `users.security.oauthProviderInvalid`
- `users.security.returnToInvalid`
- `users.settings.productUpdatesInvalid`
- `users.settings.accountActivityInvalid`
- `users.settings.securityAlertsInvalid`

</details>

### New message keys (18)

<details><summary>Key list</summary>

- `jskit.errors.USER_PROFILE_EMAIL_CONFLICT`
- `jskit.users.avatar.streamMissing`
- `jskit.users.avatar.mimeTypeInvalid`
- `jskit.users.avatar.fileNameInvalid`
- `jskit.users.avatar.uploadDimensionInvalid`
- `jskit.users.security.currentPasswordInvalid`
- `jskit.users.security.newPasswordRequired`
- `jskit.users.security.newPasswordMinLength`
- `jskit.users.security.confirmPasswordRequired`
- `jskit.users.security.enabledRequired`
- `jskit.users.security.enabledInvalid`
- `jskit.users.security.oauthProviderRequired`
- `jskit.users.security.oauthProviderInvalid`
- `jskit.users.security.returnToInvalid`
- `jskit.users.feedback.validationFailed`
- `jskit.users.settings.productUpdatesInvalid`
- `jskit.users.settings.accountActivityInvalid`
- `jskit.users.settings.securityAlertsInvalid`

</details>

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".
- Saved locales are canonical BCP 47 codes (`en-AU`); the language list comes from `config.languages` when the app sets it. Exports `./shared/settings`.

### Upgrading

- Success responses that had `meta.message` also carry `meta.messageCode` and `meta.messageParams`.

### New message keys (11)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.users.profile.notFound`
- `jskit.users.avatar.notFound`
- `jskit.users.avatar.uploadResultMissing`
- `jskit.users.security.passwordChangeUnavailable`
- `jskit.users.security.passwordMethodToggleUnavailable`
- `jskit.users.security.oauthLinkUnavailable`
- `jskit.users.security.oauthUnlinkUnavailable`
- `jskit.users.security.logoutOtherSessionsUnavailable`
- `jskit.users.security.passwordConfirmationMismatch`
- `jskit.users.security.passwordUpdated`
- `jskit.users.bootstrap.authUnavailable`

</details>

### Codes (11)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `users.profile.notFound` | User profile was not found. |
| `users.avatar.notFound` | Avatar not found. |
| `users.avatar.uploadResultMissing` | Avatar upload completed without a profile result. |
| `users.security.passwordChangeUnavailable` | Password change is not available. |
| `users.security.passwordMethodToggleUnavailable` | Password method toggle is not available. |
| `users.security.oauthLinkUnavailable` | OAuth linking is not available. |
| `users.security.oauthUnlinkUnavailable` | OAuth unlink is not available. |
| `users.security.logoutOtherSessionsUnavailable` | Logout other sessions is not available. |
| `users.security.passwordConfirmationMismatch` | Password confirmation does not match. |
| `users.security.passwordUpdated` | Password updated. |
| `users.bootstrap.authUnavailable` | Authentication service temporarily unavailable. Please retry. |
