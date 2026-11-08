# Changelog

## Unreleased

- The workspace settings colours and `invitesEnabled`, and the role and status of a membership and of an invite, are no longer `required`, which `defineTableResource` now refuses beside `defaultTo`: a create that leaves one out gets its default where it failed REQUIRED. The settings contract keeps its own body and output schemas, so requests are unchanged.
- `workspaces.listByIds(ids, options)` reads the workspaces with these ids in one statement however many, sorted by id; an id naming none is left out and a deleted workspace kept, as `findById` keeps it. A caller that read one workspace per id with `findById` reads them at once.
- `workspaces.joinSource({ alias, filters }, options)` and `workspaces.memberships.joinSource({ alias, filters }, options)` answer `{ query, column }`: the scoped workspaces or memberships under `alias`, matching the resource's search filters (such as `{ deletedAt: null }`, or `{ workspace, status: "active" }`), and each field's column under that alias. Another feature's report joins them as subqueries in its own statement, instead of joining `workspaces` or `workspace_memberships` by name, which reads them past their owner.
- `@jskit-ai/workspaces-core/test/WorkspaceRecordsFeature` exports `WorkspaceRecordsFeature`, for an application's tests. It owns the workspaces tables as `workspaces.core` does and provides only its records, `workspaces` and `workspaces.memberships`, without the routes, settings and invitations, so a test can start it beside the feature it tests with `startTestFeatures`. `WorkspacesFeature` and it name the four tables once, as `WORKSPACES_TABLES`.
- The workspaces, memberships, invites and settings table resources no longer declare their own `id` search entry (nor `search: true` on the settings' `id` field): their handles' `id` filter takes one id or a list.
- Security: a new workspace that loses its slug to a concurrent create answers the workspace already there only when that one has the same owner and the same personal flag (a personal workspace made twice at a first sign-in). It never answers another owner's workspace, which it used to; the directory then picks the next free slug and creates the caller's own, up to three times, and a duplicate inside the caller's transaction fails it as before.
- The invitation bootstrap audience says `publicTablesOnly: true`: it reads the invite and the recipient's profile, both public tables, so an app needs no `RealtimeAudienceScopeFeature` for it, now that realtime refuses to boot without one for any other `audienceUsers` audience.
- `workspaces.memberships` gains `listByWorkspaceId(workspaceId, options)`: every member of a workspace whatever their membership's status, such as one just removed (`revoked`), each summary with its status, as `listActiveByWorkspaceId` lists the active ones, in the same single read with the users included.
- **Breaking (data-access redesign).** `WorkspacesFeature` owns the `workspaces`, `workspace_memberships`, `workspace_invites` and `workspace_settings` tables through `defineFeature({ owns })` and its repositories read and write them through their resource handles, instead of registering them on `runtime.json-rest-api`; it requires `runtime.resources`. `installWorkspaceResources` is removed. `workspaces`, `workspaces.memberships` and `workspaces.core` keep their methods and answers. Each repository's `withTransaction(options, work)` runs `work(txOptions)` in the caller's transaction or in one it opens. The `workspaces` capability and the invites repository answer `inTransaction(options)`, whether a call runs inside a transaction, so the invitation protocol's guards (prepareInvite needs the caller's transaction; createInvite, sendInvite and invitation acceptance and refusal open their own) keep their messages without reading the transaction. Behaviour differences: `updateById` of a missing workspace answers `null` outside a transaction instead of failing with json-rest-api's 404; an invitation's locking read takes the matching invites' ids and then locks them by id (see the resource handle's `lockWhere`); and the memberships reads that only need ids no longer include each workspace and user.
- **Breaking (data-access redesign).** Each workspaces table is one table resource, registered under its name: `workspaceResource` (`workspaces`), `workspaceSettingsResource` (`workspaceSettings`), `workspaceMembershipsResource` (`workspaceMemberships`) and `workspaceInvitesResource` (`workspaceInvites`). Workspaces and their settings have CRUD contracts, `workspaceCrud` (namespace `workspace`) and `workspaceSettingsCrud`, with view, list, create, replace and patch. Memberships and invites have no HTTP surface, so their unserved CRUD operations are gone, with the five feedback keys only they used (`fixInvalidValues`, `recordSaved`, `recordSaveFailed`, `recordDeleted`, `recordDeleteFailed`). The member and pending-invitation operations are API contracts: `workspaceMembersContract` and `workspacePendingInvitationsContract`.
- A workspace request's auth policy and its action context share one workspace context resolution: `resolveWorkspaceContextForUserBySlug` called with the same `request` (the auth policy resolver now passes it, as the action context contributor already did), user, slug and membership requirement reads the workspace, membership and workspace settings once instead of once per check, so a workspace action with a permission no longer repeats those reads before its handler. Calls without a request, or in a transaction, resolve on their own as before.
- `workspaceMembershipsRepository.listActiveWorkspaceIdsByUserIds(userIds, options)` answers many users' active workspace ids as a `Map` in one query per 1,000 users, reading the memberships' `workspace_id` instead of including each workspace. The memberships resource gains the `users` filter (`user_id in [...]`) it uses. The realtime audience contributor (`workspaces.memberships`) answers realtime's bulk `resolveActorsScopes(actorIds)` with it, so a workspace event costs one memberships query, not one per online user.
- A new workspace's slug (`base`, then `base-2` to `base-1000`) is chosen with one read of every taken candidate through `workspacesRepository.listSlugsIn(slugs, options)` and the workspace resource's new `slugs` filter (`in`), instead of one `findBySlug` per taken candidate, so a common name costs the same statements after 10 namesakes as after 200. The chosen slug and the error when all 1,000 are taken are unchanged.
- `services.members.getMember(workspace, userId, options)` answers one active member's summary, the same as their `listMembers` entry, or `null` for a removed or unknown member. It reads that one membership through `workspaceMembershipsRepository.findActiveByWorkspaceIdAndUserId`, so a per-member lookup (a notification's recipient check, for example) costs the same few statements in a workspace of 10 or 1,000 members instead of listing them all.
- The workspace, settings, member and invitation field messages are sent in the coded form `{ code, message, params }`, so their field errors translate. The English is unchanged.
- The resources' save, delete and validation feedback names catalog keys under `jskit.workspaces.feedback.*` instead of plain English; JSKIT's forms render them with `text()`, so the English shown is unchanged.
- The invitation email writes its expiry date with `Intl` in the recipient's locale and saved time zone (UTC without one), for example "November 2, 2026 at 12:00 AM UTC", instead of the raw ISO timestamp. An app's own `workspaces.invite-email-template` also receives the recipient's `timeZone` next to `locale`.
- **Breaking (data-access redesign).** The workspaces and their memberships are their owners' capabilities, provided by `WorkspacesFeature`: `workspaces` (`findById`, `findBySlug`, `listSlugsIn`, `findPersonalByOwnerUserId`, `listForUserId`, `insert`, `updateById`, `lock`) and `workspaces.memberships` (`findByWorkspaceIdAndUserId`, `ensureOwnerMembership`, `upsertMembership`, `addMember`, `activeMemberIds`, `listActiveByWorkspaceId`, `findActiveByWorkspaceIdAndUserId`, `listActiveWorkspaceIdsByUserId(s)`). `workspaces.core`'s `repositories` keep `workspaceInvites` and `workspaceSettings`. The types are `Workspaces` and `WorkspacesMemberships`. The feature requires `users.profiles` and `users.settings` instead of `users.core`.
- `findBySlug` no longer finds a deleted workspace; its slug stays taken. A workspace request to a deleted workspace's slug now answers 404 `workspaces.workspace.notFound` instead of resolving that workspace.
- New `lock(workspaceId, options)` on `workspaces` takes the workspace's row lock until the caller's transaction ends; it needs the caller's transaction (the `txOptions` of `withTransaction`) and answers `{ id }`, or `null` when there is no such workspace. The invitations' lock (`lockWorkspaceForInvitations`) is built on it and keeps its 404 `workspaces.invite.workspaceMissing`.
- New `addMember({ workspaceId, userId, roleSid }, options)` on `workspaces.memberships` makes the user an active member with the role (`member` when none is given), adding the membership or reactivating it, and `activeMemberIds(workspaceId, options)` answers the active members' user ids at the same cost however many members there are (one page per 1,000 memberships), without including their profiles.
- The bootstrap change of a created or revoked invitation reaches its recipient through realtime's `audienceUsers`: the members service's new `inviteRecipientUserIds(inviteId, options)` reads the invitation (the invites repository's new `findById`, in any status) and the profile with its email through `users.profiles`, instead of a hand-written join of the two tables.
- `createWorkspacesRuntime` takes the four tables' handles as `resources`, with `userProfiles`, `userSettings`, `workspaces` and `workspaceMemberships`, instead of `users`; the new `createWorkspaceRecords(resources)`, exported beside it, builds the last two from the handles.

### Upgrading

- Replace `workspaces.repositories.workspaces` with the `workspaces` capability and `workspaces.repositories.workspaceMemberships` with `workspaces.memberships`. Application composition that locked a workspace with `workspaces.repositories.workspaceInvites.lockWorkspaceForInvitations(workspaceId, { trx })` uses `lock(workspaceId, txOptions)` of `workspaces` inside `withTransaction(options, async (txOptions) => …)`, which answers `null` instead of throwing when the workspace is missing.
- Code that found a deleted workspace by slug reads it by id.
- Tests that call `createWorkspacesRuntime({ ..., users })` own the four tables, `runtime.own("workspaces.core", [workspaceResource, workspaceMembershipsResource, workspaceInvitesResource, workspaceSettingsResource])` on a `createTestResourceRuntime` of `@jskit-ai/resource-runtime/test`, and pass the handles as `resources`, with `userProfiles`, `userSettings` and the `workspaces` and `memberships` of `createWorkspaceRecords(resources)`. Tests that called `installWorkspaceResources(api)` own the tables the same way.
- `repository.withTransaction(async (trx) => …)` with `{ trx }` passed inside becomes `repository.withTransaction(options, async (txOptions) => …)` with `txOptions` passed inside.

### New codes (21)

<details><summary>Code list</summary>

- `workspaces.workspace.avatarUrlInvalid`
- `workspaces.invite.decisionRequired`
- `workspaces.invite.decisionInvalid`
- `workspaces.settings.lightPrimaryColor.required`
- `workspaces.settings.lightPrimaryColor.invalid`
- `workspaces.settings.lightSecondaryColor.required`
- `workspaces.settings.lightSecondaryColor.invalid`
- `workspaces.settings.lightSurfaceColor.required`
- `workspaces.settings.lightSurfaceColor.invalid`
- `workspaces.settings.lightSurfaceVariantColor.required`
- `workspaces.settings.lightSurfaceVariantColor.invalid`
- `workspaces.settings.darkPrimaryColor.required`
- `workspaces.settings.darkPrimaryColor.invalid`
- `workspaces.settings.darkSecondaryColor.required`
- `workspaces.settings.darkSecondaryColor.invalid`
- `workspaces.settings.darkSurfaceColor.required`
- `workspaces.settings.darkSurfaceColor.invalid`
- `workspaces.settings.darkSurfaceVariantColor.required`
- `workspaces.settings.darkSurfaceVariantColor.invalid`
- `workspaces.settings.invitesEnabled.required`
- `workspaces.settings.invitesEnabled.invalid`

</details>

### New message keys (33)

<details><summary>Key list</summary>

- `jskit.workspaces.workspace.avatarUrlInvalid`
- `jskit.workspaces.invite.decisionRequired`
- `jskit.workspaces.invite.decisionInvalid`
- `jskit.workspaces.feedback.validationFailed`
- `jskit.workspaces.feedback.fixInvalidValues`
- `jskit.workspaces.feedback.recordSaved`
- `jskit.workspaces.feedback.recordSaveFailed`
- `jskit.workspaces.feedback.recordDeleted`
- `jskit.workspaces.feedback.recordDeleteFailed`
- `jskit.workspaces.feedback.workspaceInvalid`
- `jskit.workspaces.feedback.workspaceUpdated`
- `jskit.workspaces.feedback.workspaceUpdateFailed`
- `jskit.workspaces.feedback.settingsInvalid`
- `jskit.workspaces.feedback.settingsUpdated`
- `jskit.workspaces.feedback.settingsUpdateFailed`
- `jskit.workspaces.settings.lightPrimaryColor.required`
- `jskit.workspaces.settings.lightPrimaryColor.invalid`
- `jskit.workspaces.settings.lightSecondaryColor.required`
- `jskit.workspaces.settings.lightSecondaryColor.invalid`
- `jskit.workspaces.settings.lightSurfaceColor.required`
- `jskit.workspaces.settings.lightSurfaceColor.invalid`
- `jskit.workspaces.settings.lightSurfaceVariantColor.required`
- `jskit.workspaces.settings.lightSurfaceVariantColor.invalid`
- `jskit.workspaces.settings.darkPrimaryColor.required`
- `jskit.workspaces.settings.darkPrimaryColor.invalid`
- `jskit.workspaces.settings.darkSecondaryColor.required`
- `jskit.workspaces.settings.darkSecondaryColor.invalid`
- `jskit.workspaces.settings.darkSurfaceColor.required`
- `jskit.workspaces.settings.darkSurfaceColor.invalid`
- `jskit.workspaces.settings.darkSurfaceVariantColor.required`
- `jskit.workspaces.settings.darkSurfaceVariantColor.invalid`
- `jskit.workspaces.settings.invitesEnabled.required`
- `jskit.workspaces.settings.invitesEnabled.invalid`

</details>

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".
- Workspace invitation emails are rendered in the recipient's saved locale (`createServerI18n`); `WorkspacesFeature` requires the `runtime.app-root` capability.

### New message keys (34)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.workspaces.auth.required`
- `jskit.workspaces.user.invalidPayload`
- `jskit.workspaces.workspace.slugUnavailable`
- `jskit.workspaces.workspace.creationDisabled`
- `jskit.workspaces.workspace.nameRequired`
- `jskit.workspaces.workspace.contextDisabled`
- `jskit.workspaces.workspace.slugRequired`
- `jskit.workspaces.workspace.notFound`
- `jskit.workspaces.workspace.accessDenied`
- `jskit.workspaces.member.roleNotAssignable`
- `jskit.workspaces.member.notFound`
- `jskit.workspaces.member.ownerRoleLocked`
- `jskit.workspaces.member.ownerNotRemovable`
- `jskit.workspaces.invite.disabled`
- `jskit.workspaces.invite.notFound`
- `jskit.workspaces.invite.notFoundOrHandled`
- `jskit.workspaces.invite.invitationNotFoundOrHandled`
- `jskit.workspaces.invite.workspaceMissing`
- `jskit.workspaces.invite.expired`
- `jskit.workspaces.invite.tokenMismatch`
- `jskit.workspaces.invite.tokenRequired`
- `jskit.workspaces.invite.tokenInvalid`
- `jskit.workspaces.invite.emailMismatchUser`
- `jskit.workspaces.invite.emailMismatchAccount`
- `jskit.workspaces.invite.notAvailable`
- `jskit.workspaces.invite.mailerUnconfigured`
- `jskit.workspaces.invite.sendFailed`
- `jskit.workspaces.inviteEmail.subject`
- `jskit.workspaces.inviteEmail.intro`
- `jskit.workspaces.inviteEmail.introFromInviter`
- `jskit.workspaces.inviteEmail.expiry`
- `jskit.workspaces.inviteEmail.openLink`
- `jskit.workspaces.inviteEmail.accept`
- `jskit.workspaces.inviteEmail.workspaceFallback`

</details>

### Codes (27)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `workspaces.auth.required` | Authentication required. |
| `workspaces.user.invalidPayload` | Invalid authenticated user payload. |
| `workspaces.workspace.slugUnavailable` | Unable to generate unique workspace slug. |
| `workspaces.workspace.creationDisabled` | Workspace creation is disabled for this tenancy mode. |
| `workspaces.workspace.nameRequired` | Workspace name is required. |
| `workspaces.workspace.contextDisabled` | Workspace context is disabled. |
| `workspaces.workspace.slugRequired` | workspaceSlug is required. |
| `workspaces.workspace.notFound` | Workspace not found. |
| `workspaces.workspace.accessDenied` | You do not have access to this workspace. |
| `workspaces.member.roleNotAssignable` | Role is not assignable. |
| `workspaces.member.notFound` | Member not found. |
| `workspaces.member.ownerRoleLocked` | Cannot change workspace owner role. |
| `workspaces.member.ownerNotRemovable` | Cannot remove workspace owner. |
| `workspaces.invite.disabled` | Workspace invitations are disabled. |
| `workspaces.invite.notFound` | Invite not found. |
| `workspaces.invite.notFoundOrHandled` | Invite not found or already handled. |
| `workspaces.invite.invitationNotFoundOrHandled` | Invitation not found or already handled. |
| `workspaces.invite.workspaceMissing` | Invitation workspace no longer exists. |
| `workspaces.invite.expired` | Invitation has expired. |
| `workspaces.invite.tokenMismatch` | Invitation token does not match the saved invitation. |
| `workspaces.invite.tokenRequired` | Invite token is required. |
| `workspaces.invite.tokenInvalid` | Invite token is invalid. |
| `workspaces.invite.emailMismatchUser` | Invitation email does not match authenticated user. |
| `workspaces.invite.emailMismatchAccount` | Invitation email does not match account email. |
| `workspaces.invite.notAvailable` | Invitation is not available. |
| `workspaces.invite.mailerUnconfigured` | No workspace invite mailer is configured. |
| `workspaces.invite.sendFailed` | Unable to send workspace invite email. |
