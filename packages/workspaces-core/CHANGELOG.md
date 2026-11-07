# Changelog

## Unreleased

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
- New `lock(workspaceId, options)` on `workspaces` takes the workspace's row lock until the caller's transaction ends; it needs an active `options.trx` and answers `{ id }`, or `null` when there is no such workspace. The invitations' lock (`lockWorkspaceForInvitations`) is built on it and keeps its 404 `workspaces.invite.workspaceMissing`.
- New `addMember({ workspaceId, userId, roleSid }, options)` on `workspaces.memberships` makes the user an active member with the role (`member` when none is given), adding the membership or reactivating it, and `activeMemberIds(workspaceId, options)` answers the active members' user ids at the same cost however many members there are (one page per 1,000 memberships), without including their profiles.
- The bootstrap change of a created or revoked invitation reaches its recipient through realtime's `audienceUsers`: the members service's new `inviteRecipientUserIds(inviteId, options)` reads the invitation (the invites repository's new `findById`, in any status) and the profile with its email through `users.profiles`, instead of a hand-written join of the two tables.
- `createWorkspacesRuntime` takes `userProfiles`, `userSettings`, `workspaces` and `workspaceMemberships` instead of `users`; the new `createWorkspaceRecords(jsonRestApi)`, exported beside it, builds the last two.

### Upgrading

- Replace `workspaces.repositories.workspaces` with the `workspaces` capability and `workspaces.repositories.workspaceMemberships` with `workspaces.memberships`. Application composition that locked a workspace with `workspaces.repositories.workspaceInvites.lockWorkspaceForInvitations(workspaceId, { trx })` uses `lock(workspaceId, { trx })` of `workspaces`, which answers `null` instead of throwing when the workspace is missing.
- Code that found a deleted workspace by slug reads it by id.
- Tests that call `createWorkspacesRuntime({ ..., users })` pass `userProfiles`, `userSettings` and the `workspaces` and `memberships` of `createWorkspaceRecords(jsonRestApi)`.

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
