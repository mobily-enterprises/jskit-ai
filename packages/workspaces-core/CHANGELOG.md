# Changelog

## Unreleased

- `workspaces.core` gains `roleContext({ workspaceId, userId, role, reason }, { context: systemContext(reason), trx? })`, the context of installer and seed work done in one workspace as a user in a role of the role catalog that they are not given there: required records a workspace gets for the platform's owner, who is normally no member of a self-created workspace, or a seed's starter data. It has exactly a member context's shape (`actor`, `workspace`, `membership`, `permissions`, the `workspace_user` visibility context and `requestMeta.resolvedWorkspaceContext`) with the membership `{ workspaceId, userId, roleSid, status: "active" }`, which is never saved and replaces any membership the user has there, and the role's permissions, so a permission check and a row policy decide as for a member in that role; it also records `reason`, which a row policy reads as `caller.reason` and which grants nothing. It is no system context and no job: request row limits apply and other owners' hidden fields stay hidden. Only a system context makes one, with a non-empty reason; any other context, a missing reason, ids that are no record ids and a role the catalog lacks are a TypeError before any statement, a missing or deleted workspace is 404 `workspaces.workspace.notFound`, a user id naming no one 404 `users.profile.notFound`, and an application without workspaces 403 `workspaces.workspace.contextDisabled`. It reads the user, the workspace and its settings, and writes nothing (no settings, no owner membership). The directory service's new `resolveRoleWorkspaceContextById(user, workspaceId, roleSid, options)` builds it. `memberContext` is unchanged and still means real membership only.
- An action run in a context that already carries the resolved context of the action's workspace (`requestMeta.resolvedWorkspaceContext` with that workspace's slug, as a member context and a role context carry it) keeps it: the workspace action context contributor no longer reads the workspace, the membership and the settings again, so a role context's unsaved membership survives into the action, and a member context's action no longer repeats its reads.

- A new PostgreSQL or SQLite database migrates again with workspaces-core. In 0.2.80 its first `db:migrate` failed with `migration file "workspaces_core_indexes_by_user.cjs" failed` (`relation "workspace_memberships" does not exist` on PostgreSQL, `no such table` on SQLite): Knex runs a package's migrations in file name order, which put the new index migration before `workspaces_core_initial`, the one that makes the tables. `workspaces_core_indexes_by_user` now does nothing when the tables do not exist yet, and the new `workspaces_core_person_indexes`, which runs after `workspaces_core_initial`, adds `ix_workspace_memberships_user` and `ix_workspaces_owner` when they are missing. A database that already ran `workspaces_core_indexes_by_user` keeps its two indexes, and the new migration adds no second copy. MariaDB and MySQL were not affected and nothing changes there. Run `db:migrate`.
- Making a workspace (`workspace.workspaces.create`) and changing its name or avatar (`workspace.workspaces.update`) publish an entity change of the workspace itself on `runtime.events`: `type` "entity.changed", `source` "workspace", `entity` "workspace", `operation` "created" or "updated", `entityId` the workspace's id from the action's answer. Before, neither action published anything, so an application keeping its own copy of workspace facts (a directory, an index of names) heard of a member or a settings change but never of a new or renamed workspace. The events carry no realtime delivery; no browser is told.

- A person's workspaces are read through an index on PostgreSQL: the new migration `workspaces_core_indexes_by_user` adds `ix_workspace_memberships_user` (`workspace_memberships.user_id`), which `workspaces.listForUserId` and `workspaces.memberships.listActiveWorkspaceIdsByUserId` read by, and `ix_workspaces_owner` (`workspaces.owner_user_id`), which `workspaces.findPersonalByOwnerUserId` reads by. PostgreSQL indexes no foreign key's columns by itself, so each of those reads scanned every membership or workspace; the memberships' unique `(workspace_id, user_id)` key serves a workspace's members, not a person's workspaces. MariaDB and MySQL already index both columns through their foreign keys' own indexes, so there the migration changes nothing. Run `db:migrate`.

- `workspaces.core` gains `memberContext({ workspaceId, userId }, { context: systemContext(reason), trx? })`, the context of one member of one workspace for background work done as that member: a record started for the person it is assigned to, a notification for one recipient, a member's template setup, a submission synced for the person who made it. It is resolved as the member's own request on a `workspace_user` route is, by the same reads (the workspace, the active membership with the owner's ensured, the role's permissions and the settings), now shared with that request's resolution through the directory service's new `resolveMemberWorkspaceContextById(user, workspaceId, options)`, and refused as it is: 404 `workspaces.workspace.notFound` for a missing or deleted workspace, 403 `workspaces.workspace.accessDenied` for a user who is no active member (removed, inactive, never one, or no user), 403 `workspaces.workspace.contextDisabled` without workspaces. The context signs the member in (`actor`, so `resolveActorId` answers them and an action checks their `permissions`), carries `workspace`, `membership`, `permissions`, the `workspace_user` visibility context and `requestMeta.resolvedWorkspaceContext`, and is no system context or job: request row limits apply, other owners' hidden fields stay hidden and a row policy is told `caller.kind` "user". Only a system context makes one; any other context, a `forWorkspace` job's too, and ids that are no record ids are a TypeError before any statement. An action runs in it with `actions.execute({ actionId, input, context: { ...member, surface: "app" } })` and sees what the member's request on that route sees. JSKIT keeps no disabled flag on users, so it reads no sign-in state: an account its auth provider refuses at sign-in is still resolved.
- `workspaces.listForSystem({ afterId, limit }, { context: systemContext(reason) })` answers one page of the workspaces that are not deleted, `{ id, slug }` in id order, after `afterId` (from the first when it is null) and at most `limit` (1 to `pageLimits().request`, 100 by default), for a background job that visits every workspace. A page is one statement however many workspaces there are: among 10 workspaces and among 200 alike. Any context that is not a system context, a `forWorkspace` or `forUser` job's included, an `afterId` that is no workspace id and a `limit` out of range are a TypeError before any statement. The workspaces table resource's search gains `idAfter` (`id > value`) for it.
- An invitation's response carries whatever delivery status its invite mailer answers, such as `held` for an email the application keeps until its email is set up. The create-invite output's `inviteDelivery.status` and the invite assistant tool's `deliveryStatus` allowed only `sent`, `simulated`, `failed` and `mailer_unconfigured`, so an invitation the assistant made through a mailer answering another status was saved and then failed with "Assistant tool output validation failed.", and the API contract did not describe the status it sent. Both are now any non-empty string. `WorkspaceInviteMailer`'s documentation names the statuses the members panel words itself and says it shows the result's `message` for any other.
- `workspaces.memberships.lockByWorkspaceIdAndUserId` locks its membership with `lockWhere`'s `limit: 1` (the workspace and the user are the table's unique key): one statement on PostgreSQL, where it sent two, and with json-rest-api 3.1.8 one on MariaDB and MySQL as well, whose read of the connection's schema and of the membership's links (to public tables whose foreign keys protect them) it no longer needs, as the membership's `lock(id)` costs, among 10 members and among 200.
- `GET .../members` and `GET .../invites` (`workspace.members.list` and `workspace.invites.list`) answer a request that leaves out `page[cursor]` or `page[limit]` again, such as every first page the members screen reads (`page[limit]=20`). Since 0.2.25 those answered 400 `ACTION_VALIDATION_FAILED`, "Value could not be cast to the required type." at `/data/attributes/cursor` (and at `/data/attributes/limit` when no limit was named), so the members screen showed no members and no invitations in any workspace. The routes handed their action `cursor` and `limit` by name, undefined when the query left one out, and an action's input refuses a field that is present but undefined; they now hand on only the fields the query sends. A route test reads both lists, first and next pages, through Fastify, the auth policy, the list actions and the JSON:API transport and serializer.

- A workspace route whose auth policy and action context differ in requiring membership (`contextPolicy: "optional"` on a route with `visibility: "workspace"`) reads its workspace context once per request instead of twice. The per-request cache keyed its reads by the membership requirement as well as the user and slug, so the two callers read the workspace, the membership and the settings each. Reads are now cached per user and slug, and each caller checks membership against the shared result: 401 `workspaces.auth.required` signed out, 403 `workspaces.workspace.accessDenied` for a non-member where membership is required, as before.
- The workspace invite mailer's `sendWorkspaceInvite` receives the invitation's id as `inviteId`, beside `email`, `inviteUrl`, `workspace` (with its `id`), `inviter`, `roleSid`, `expiresAt`, `locale` and `message`, so a mailer can record which invitation each email delivers.
- A test copy (`SIDE_EFFECTS` is not `live`) sends no invitation email: a provided invite mailer is replaced by one that logs the invitation and answers the new delivery status `simulated`, with "Test copy: the invitation email was not sent. Copy the invite link to share it." (`workspaces.invite.simulated`). The feature now requires `runtime.logger`.
- A workspace route that names no permission of its own, such as every CRUD route, reads its workspace context once per request instead of twice. The route visibility resolver read the workspace, the membership and the settings without the request, so the workspace action context contributor read them all again: a CRUD list sent six statements more than it needed (on SQLite, 13 statements where 7 do). The visibility resolver now passes the request, and both share the request's one resolution, as the auth policy and the action context already did. The same user, workspace, membership and permissions decide, with the same refusals: 401 signed out, 403 `workspaces.workspace.accessDenied` for a non-member, 404 `workspaces.workspace.notFound` for an unknown slug and 403 `ACTION_PERMISSION_DENIED` for a member without the permission.
- The unknown-grant refusal now says, right after the grants it reports, to search the application's own code for a permission before removing or renaming its grant (`hasPermission()`, `can()`, permission string checks, including names built in code such as `` `crud.${resource}.list` ``), since the check cannot see those; a permission the application checks goes in `roleCatalog.customPermissions`, and a grant is removed only when nothing uses it. Before, a reported grant that an application service still checked with `hasPermission()` read as dead, and removing it took that access from every role but the owner. The did-you-mean suggestions are unchanged, and the workspace-server pattern says the same.
- A role that grants a permission nothing requires is caught when the server starts, where before it silently left the role refused (`ACTION_PERMISSION_DENIED`) wherever the grant was meant to allow it, such as `crud.labels.patch` for the update operation. The new `WorkspaceRoleGrantsProvider` (`workspaces.role-grants`, which needs `runtime.logger`) compares each role's own grants with the permissions the registered actions, the routes' `permission` and the surface access policies require, and the new `roleCatalog.customPermissions`, a list of the permission names the application checks itself (a service, a row policy, the browser). A grant that covers none, an exact name, a `<prefix>.*` or a `*` placed where it matches nothing, is reported at the role that writes it with the name it probably meant: `Role "member" grants "crud.labels.patch", which no action requires; did you mean "crud.labels.update"?`. Outside production the server refuses to start; in production it starts and logs a warning, since such a grant gives nothing. An application whose roles grant a permission it checks only itself adds it to `customPermissions`. Without workspaces nothing is checked.

- The realtime audience contributor answers a question about some scopes by reading only the memberships of the workspaces they name, with the new `workspaces.memberships.listActiveWorkspaceIdsByUserIdsAmong(userIds, workspaceIds, options)`, and reads nothing when they name no workspace (a publish to user rooms). Before, every publish read all the active memberships of every online actor.
- **Breaking.** The members and invites lists answer one page at a time, and each page is one statement. Before this, they read every active membership or pending invite and sorted them in code.
  - `GET .../members` and `GET .../invites` (the `workspace.members.list` and `workspace.invites.list` actions) take `limit` (1 to 100, 20 when none) and `cursor`, the previous page's `nextCursor`. They answer the page with `nextCursor`, which is null on the last page.
  - Members stay in display-name order, now by the database's collation and then by user id. Invites stay newest first, with invites made in the same second in the order they were made.
  - `services.members.listMembersPage(workspace, query, options)` answers one page of members, for a screen. `listMembers(workspace, options)` still answers every active member, for work that needs them all. `listMembersResponse` and `listInvitesResponse`, which the list actions call, take the page query before the options. A member change, an invitation and a revocation answer the list's first page.
  - The members page is one report on the memberships joined to `users.profiles`' join source (`workspaceMemberPagesRepository`, a new dependency of the members service). The invites repository gains `listPendingPageByWorkspaceId(workspaceId, { size, after }, options)`.
  - A cursor the members list did not answer is refused with 400 `workspaces.member.cursorInvalid`.
- The optional `workspaces.workspace-created-participant` capability writes an application's records for every new workspace in the creation's transaction, as `workspaces.invite-acceptance-participant` does for an accepted invitation: one function `({ workspace, owner }, { trx, context })`, with `workspace` and `owner` shallow frozen. Both creation paths call it, the `workspace.workspaces.create` action (`createWorkspaceForAuthenticatedUser`) and a personal workspace's provisioning (`ensurePersonalWorkspaceForUser`, inside a first sign-in's profile sync), after the workspace, its owner's membership and its settings are written. Creating a workspace is now one transaction, the caller's or its own, where the named create wrote its three rows one after the other: a failure, the participant's or a later write's, leaves no workspace, membership or settings row and none of the participant's writes, and the caller receives the failure itself. A create that loses its slug to another create runs again with the next free slug, and one that loses it to the same owner's identical create answers that workspace, as the repository's insert did, without calling the participant twice. Without the capability, creation writes the workspace, membership and settings only.
- A member's role change and their removal lock the membership before they check it, so two at once run one after the other and the second decides on what the first left: a role change that waited for a removal answers 404 `workspaces.member.notFound` instead of making the removed member active again, and a removal that waited for a role change keeps the new role instead of writing back the one it read. `workspaces.memberships` gains `lockByWorkspaceIdAndUserId(workspaceId, userId, txOptions)`, the membership locked until the caller's transaction ends, or null.
- Expiring an email's pending invites (`expirePendingByWorkspaceIdAndEmail`, which every new invite runs first) is one `patchWhere` on the invites, where it locked them and then patched them one at a time: its statements no longer grow with the invites the email had.
- `workspaces.joinSource` and `workspaces.memberships.joinSource` are the handle's `joinSource` (`@jskit-ai/resource-runtime`): the same `{ query, column }` for the same params, carrying the columns a read answers instead of every column of the table. A report that names its columns with `column(field)` reads as before.
- An anonymous visitor on a workspace surface that does not require membership (`requireMembership: false`, such as a public payment link under `/api/w/<slug>/...`) resolves to the workspace with no membership and no permissions, as a signed-in non-member does, where every such request answered 401 `workspaces.auth.required`. A surface that requires membership still answers 401 to an anonymous visitor, before it reads the workspace.
- Its table resources declare the foreign keys their migrations create (`foreignKeys`), so json-rest-api 3.1.0 can skip the visibility query a system-context read makes for a record such a key guarantees exists. `jskit test --databases` checks each against an app's test database: workspaces.owner_user_id to users; workspace_memberships.workspace_id to workspaces and user_id to users; workspace_settings.workspace_id to workspaces; workspace_invites.workspace_id to workspaces and invited_by_user_id to users. `repositories.integration.test.js` proves the declarations, and users-core's, match the migrations on its database (SQLite, or MariaDB or PostgreSQL with JSKIT_REPOSITORY_TEST_DATABASE_URL).
- The workspace settings colours and `invitesEnabled`, and the role and status of a membership and of an invite, are no longer `required`, which `defineTableResource` now refuses beside `defaultTo`: a create that leaves one out gets its default where it failed REQUIRED. The settings contract keeps its own body and output schemas, so requests are unchanged.
- `@jskit-ai/database-runtime` and `@jskit-ai/resource-runtime` are peer dependencies, required and at the same versions, where they were dependencies: its workspaces, memberships, invites and settings are table resources, and the app holds one copy of the table runtime that every package shares, as it does the kernel. npm installs a required peer as it installed the dependency, so an app installs the same packages and versions; a release whose versions disagree now fails the install with ERESOLVE instead of nesting a second copy.
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
