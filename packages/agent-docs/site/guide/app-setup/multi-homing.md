# Workspace tenancy

Use JSKIT workspaces when routes, records, or permissions belong to a selected
workspace and membership or role changes access.

```bash
npm install @jskit-ai/workspaces-web
npm run db:migrate
```

The dependency graph supplies `workspaces-core` and the required users runtime.
Package migrations run from their installed locations through the application's
normal Knex command.

## Decide the tenancy model first

Choose whether the product is:

- global, with no workspace concept;
- personal, with one automatically provisioned personal workspace; or
- multi-workspace, with named workspaces, membership, invitations, and
  switching.

Do not add workspace machinery to a product that only needs an owner id on one
domain record.

Set the model with `tenancyMode` and `tenancyPolicy` in `config/public.js`:

| `tenancyMode` | Workspaces | First workspace | Creating more |
| --- | --- | --- | --- |
| `none` | None | None | No |
| `personal` | One personal workspace per user | Always provisioned | No |
| `workspaces` | Named workspaces with membership, invitations and switching | Only with `tenancyPolicy.workspace.autoProvision: true` | With `tenancyPolicy.workspace.allowSelfCreate: true` |

In `workspaces` mode the product chooses one of two styles:

- **Team-first** (the default, `autoProvision` unset or `false`): a new account
  has no workspace until it creates one or accepts an invitation. Mount the
  **Your workspaces** page (see [Browser composition](#browser-composition)) so
  these people can do either.
- **Personal workspace plus shared workspaces** (`autoProvision: true`): every
  user, including people who signed up through an invitation, owns one personal
  workspace and can also join or create others.

```js
// config/public.js
config.tenancyMode = "workspaces";
config.tenancyPolicy = {
  workspace: {
    allowSelfCreate: true,
    autoProvision: true
  }
};
```

Provisioning runs in the users profile-sync lifecycle after registration and
sign-in, at each session refresh, and on a request whose identity's email or
display name changed. The first run creates the personal workspace, its owner
membership and its settings; later runs reuse it. An ordinary request only reads
the existing profile, so a personal workspace, owner membership or settings row
deleted while the person is signed in comes back at their next sign-in or
session refresh, not at their next request. The default name is the user's display name,
or email, followed by "'s Workspace". To choose another, provide the
`workspaces.personal-workspace-name` capability from an application feature. It
receives the synchronized profile (`id`, `displayName`, `email`, `username`), and
an empty result keeps the default:

```js
import { defineFeature } from "@jskit-ai/kernel/server/features";
import { homeWorkspaceName } from "./homeWorkspaceName.js";

const AppPersonalWorkspaceNameFeature = defineFeature({
  id: "app.personal-workspace-name",
  provides: {
    personalWorkspaceName: "workspaces.personal-workspace-name"
  },
  setup: () => ({ personalWorkspaceName: homeWorkspaceName })
});
```

```js
// homeWorkspaceName.js
/** @type {import("@jskit-ai/workspaces-core/server/types").PersonalWorkspaceName} */
function homeWorkspaceName(user) {
  return `${user.displayName || user.email}'s home`;
}

export { homeWorkspaceName };
```

### Development sign-in

Development sign-in (`POST /api/dev-auth/login-as`, used by the Playwright
`loginAsExistingUser()` helper and managed previews) signs in as an existing
user without changing data. It does not run the profile-sync lifecycle, so
workspace provisioning and other lifecycle contributors do not run. Create the
workspaces that seeded users need in seed data, or sign in normally once.

## Data model

The package migrations create and own these tables:

| Table | Columns that applications use |
| --- | --- |
| `workspaces` | `id`, `slug` (unique), `name`, `owner_user_id`, `is_personal`, `avatar_url`, `deleted_at` |
| `workspace_memberships` | `workspace_id`, `user_id`, `role_sid`, `status`; one row per workspace and user |
| `workspace_settings` | One row per workspace keyed by `workspace_id`: the eight palette colours and `invites_enabled` |
| `workspace_invites` | `workspace_id`, `email`, `role_sid`, `status`, `token_hash`, `invited_by_user_id`, `expires_at`, `accepted_at`, `revoked_at` |

Application records that belong to a workspace use a non-null `workspace_id`
foreign key to `workspaces.id`. Read and change these tables through their
owners' capabilities (`workspaces`, `workspaces.memberships` and
`workspaces.core`, below), not directly.

## Server composition

Use `workspaces/workspace-server` for role vocabulary, creation policy,
invitations, settings, and app-owned invitation email rendering.

Two server settings are required, and the server refuses to start without
them: whether new workspaces accept invitations, and how long an invitation
lasts.

```js
// config/server.js
config.workspaceSettings = { defaults: { invitesEnabled: true } };
config.workspaceMembers = { defaults: { inviteExpiresInMs: 7 * 24 * 60 * 60 * 1000 } };
```

Workspace scope must reach repository queries. Parsing a workspace slug or
hiding an admin link is not authorization. Membership and role checks happen
before an operation discloses records or record existence.

### Workspace-scoped features and routes

For a standard CRUD resource owned by a workspace, give its table the
`workspace_id` column, set its table resource's `ownership: "workspace"`, and bind
`defineCrudFeature()` with `scope: WORKSPACE_CRUD_SCOPE` (from
`@jskit-ai/workspaces-core/server/support/workspaceCrud`) on a workspace
surface. JSKIT then filters `workspaceId` by the workspace in the route. A
repository method you add passes the call's `options` on to the table's handle,
which scopes every read and write to the context's workspace.
`workspace_user` also filters by the signed-in user. See the CRUD operations
guide.

A hand-written route registers under `/api/w/:workspaceSlug/...` with
`contextPolicy: "required"`:

```js
router.register(
  "GET",
  "/api/w/:workspaceSlug/projects",
  {
    auth: "required",
    surface: "app",
    contextPolicy: "required",
    permission: "projects.view" // optional
  },
  async function (request, reply) {
    const projects = await projectsService.listForWorkspace(request.workspace.id);
    // ...
  }
);
```

Before the handler runs, the auth plugin resolves the slug for the signed-in
user and sets `request.workspace`, `request.membership` (including `roleSid`
and `status`) and `request.permissions`. An unknown slug returns 404 and a
non-member receives 403, unless the route's `surface` uses an access policy with
`requireWorkspaceMembership: false`. A route with `permission` returns 403 when
the membership lacks it. Scope queries with `request.workspace.id`; never take a
workspace id from request input.

### Workspace services from another feature

Declare `workspaces: "workspaces.core"` in the feature's `requires`. The
capability provides:

| Member | Use |
| --- | --- |
| `workspaces.services.directory` | Workspace lists, context by slug, creation and provisioning |
| `workspaces.services.members` | Members, roles and invitations |
| `workspaces.services.pendingInvitations` | Invitation resolution, redemption and acceptance participants |
| `workspaces.services.settings` | Workspace settings |
| `workspaces.repositories.workspaceSettings`, `.workspaceInvites` | Settings and invitation records inside the application's own transactions |
| `workspaces.tenancyProfile` | The resolved tenancy mode and workspace policy |

The workspaces and their memberships are their own capabilities, for code that
reads or changes them inside its own transactions, typed `Workspaces` and
`WorkspacesMemberships` in `@jskit-ai/workspaces-core/server/types`. Every
method takes the call's `options` last and joins the transaction of the
`txOptions` it is given.

| Capability | Methods |
| --- | --- |
| `workspaces` | `findById(id, options)`, `findBySlug(slug, options)` (a deleted workspace is not found, though its slug stays taken), `listSlugsIn`, `findPersonalByOwnerUserId`, `listForUserId(userId, options)`, `insert`, `updateById`, `lock(workspaceId, options)` |
| `workspaces.memberships` | `findByWorkspaceIdAndUserId`, `ensureOwnerMembership`, `upsertMembership(workspaceId, userId, patch, options)`, `addMember({ workspaceId, userId, roleSid }, options)`, `activeMemberIds(workspaceId, options)`, `listActiveByWorkspaceId`, `findActiveByWorkspaceIdAndUserId`, `listActiveWorkspaceIdsByUserId`, `listActiveWorkspaceIdsByUserIds`, `listActiveWorkspaceIdsByUserIdsAmong(userIds, workspaceIds, options)`, `joinSource({ alias, filters }, options)` |

`addMember` makes the user an active member with the role (`member` when none
is given), adding the membership or reactivating it. `activeMemberIds` answers
every active member's user id, without their profiles: it reads all of the
workspace's active memberships, so its cost grows with the workspace, and so
do `listActiveByWorkspaceId`'s and
`workspaces.services.members.listMembers(workspace, options)`'s. Use them where
the work needs every member, such as a job, a delivery's recipients or a
realtime audience. A screen or list reads a page instead:
`workspaces.services.members.listMembersPage(workspace, { cursor, limit }, options)`
answers one page of active members by display name (`limit`, 20 when none)
with the `nextCursor` that asks for the next, null on the last, and an app's
own list of members pages them in SQL with one report over the memberships'
`joinSource`. `lock` takes
the workspace's row lock until the caller's transaction ends, so work that must
not interleave for one workspace takes turns; it runs only inside a
transaction, given its `txOptions`, and answers `{ id }`, or `null` when there
is no such workspace.

To check one person's membership, for example a notification recipient, call
`workspaces.services.members.getMember(workspace, userId, options)`. It answers
that member's `listMembers` entry, or `null` for a removed or unknown member,
and reads only that membership. Do not list every member to find one: the list
grows with the workspace, and a lookup per row multiplies it.

### Invitation email

To send invitation email, provide the optional `workspaces.invite-mailer`
capability from one of the application's providers. Without one, invitations
are still created and delivery reports `mailer_unconfigured`. The mailer, typed
`WorkspaceInviteMailer` in `@jskit-ai/workspaces-core/server/types`, is an
object whose `sendWorkspaceInvite(message, options)` receives `{ email,
inviteUrl, workspace, inviter, roleSid, expiresAt, message }`, where the inner
`message` is the rendered `{ subject, text, html }`:

```js
const InviteMailerProvider = defineProvider({
  id: "app.invite-mailer",
  provides: {
    inviteMailer: "workspaces.invite-mailer"
  },
  setup() {
    return { inviteMailer: createAppInviteMailer() };
  }
});
```

The optional `workspaces.invite-email-template` capability is a function that
renders that inner message; it receives `{ email, inviteUrl, workspace, inviter,
roleSid, roleLabel, expiresAt, locale, timeZone, t }` (`roleLabel` only when
configured; `locale` and `timeZone` are the recipient's saved settings, else
`en` and `UTC`). Provide it from an application feature, as for the mailer;
without it the built-in template renders the message, with the expiry written
as a date in that locale and time zone. Invitation links use `/invite/:token` unless
`workspaceInvitations.invitePath` names another path. The
`workspaces/workspace-server` pattern includes an example renderer.

### Workspace colours

Each workspace stores a light and a dark palette in `workspace_settings`. On
workspace routes, `workspaces-web` switches Vuetify to the `workspace-light` or
`workspace-dark` theme, built from the application's own theme with `primary`,
`secondary`, `surface` and `surface-variant` replaced by the workspace's
colours. Other routes use the application's themes.

New workspaces start from JSKIT's blue palette unless `config/server.js` sets
the application's own beside the required `invitesEnabled`. Missing colours
keep JSKIT's values; an invalid colour stops the server at startup:

```js
// config/server.js
config.workspaceSettings = {
  defaults: {
    invitesEnabled: true,
    lightPrimaryColor: "#1C1C1C",
    lightSecondaryColor: "#5C5C5C",
    lightSurfaceColor: "#FFFFFF",
    lightSurfaceVariantColor: "#424242",
    darkPrimaryColor: "#F5F5F5",
    darkSecondaryColor: "#BDBDBD",
    darkSurfaceColor: "#121212",
    darkSurfaceVariantColor: "#C8C8C8"
  }
};
```

Defaults apply when a workspace is created. Existing workspaces keep their
stored colours; change them with `PATCH /api/w/:workspaceSlug/settings` or
`workspaces.services.settings.updateWorkspaceSettings(workspace, patch)`.

`workspace_authenticated` and similar policies must implement their documented
membership semantics exactly; do not synthesize memberships to compensate for
a policy/runtime mismatch.

## Role display labels

Set optional `label` strings in the existing `roleCatalog.roles` definitions,
usually exported by `config/roles.js` and composed into application config.
For example, the package-owned `workspaces/workspace-server` example labels
`admin` as **Administrator** and `member` as **Team member**. Any application
role id can have its own label.

Labels are trimmed; missing, blank or non-string labels use the previous
display fallback. Labels do not inherit. They survive catalogue creation,
cloning and descriptor listing, and the Members, Invitations and Workspace
Settings API response schemas preserve them. Descriptors have optional
`label`; pending/resolved invitation and workspace-list records have optional
`roleLabel` beside `roleSid`.

On **Members**, both the invitation **Role** selector and each member's role
selector display configured labels. Choose a label, enter the invite email
and select **Send invite**, or choose a member's new role. Requests and stored
memberships still use role ids. Reloading shows the selected role's label.
Pending invitation captions, workspace role captions and the default
invitation email use configured labels too. Custom email renderers receive
optional `roleLabel` in addition to `roleSid`.

Add labels without changing existing permissions, inheritance, assignability
or `workspace.defaultInviteRole`. This supports application-specific and
Training roles without renaming them. `owner` is never assignable. An
application whose default invitation role is `worker` keeps that default even
if its display label is **Member**. No database migration is needed.

## Transactional invitation participation

Use `workspaces.core` to connect application records during the built-in
`workspace.invite.redeem` action. JSKIT owns tokens, invitation state and
membership. The application owns its reviewed person association, training,
access scopes and audit records.

Keep intended access in an application draft until an administrator issues an
invitation. Preparation creates a token and pending invitation without activating
membership or sending mail.

### Public server methods

These server APIs require the caller to authorize creation, delivery and
revocation in the requested workspace. Ordinary invitation routes retain their
authorization and role checks. Do not pass arbitrary HTTP input as options.

| Capability method | Contract |
| --- | --- |
| `workspaces.repositories.workspaceInvites.withTransaction(options, (txOptions) => …)` | The invitations handle's `withTransaction`: joins the caller's transaction or opens one and hands `work` the `txOptions` to pass on; awaits commit and completion hooks before resolving. Runs `work` again when the database aborts it as a deadlock victim (see [data access](https://mobily-enterprises.github.io/jskit-ai/guide/framework/data-access#transactions)). `{ ...options, outermost: true }` refuses a call that already runs inside one. |
| `workspaces.lock(workspaceId, txOptions)` (capability `workspaces`) | Locks the workspace before application receipt/draft rows when composing preparation. Requires an active transaction. |
| `workspaces.services.members.prepareInvite(workspace, actor, payload, txOptions)` | Runs only inside a transaction, given its `txOptions`. Validates the invitation role, replaces pending invitations for that workspace/email, and returns `{ createdInviteId, inviteTokenPreview }`. Never sends. |
| `workspaces.services.members.sendInvite(workspace, actor, prepared, options)` | Refuses to run inside a transaction: it delivers after the preparation's transaction commits. Reloads the committed pending invitation and workspace display data, validates expiry and token correspondence, and sends that invitation without replacement. |
| `workspaces.services.members.createInvite(workspace, actor, payload, options)` | Owns preparation and commit, then calls `sendInvite`, and answers with `sendInvite`'s result as JSON:API data (`returnJsonApiData`, read it from `.value`), as the invite action sends it. Refuses to run inside a transaction. |
| `workspaces.invite-acceptance-participant` (optional capability) | One application function receiving `({ invite, user }, options)` inside the acceptance transaction. Without it, acceptance activates the membership only. |
| `workspaces.workspace-created-participant` (optional capability) | One application function receiving `({ workspace, owner }, options)` inside a new workspace's creation transaction. Without it, creation writes the workspace, its owner's membership and its settings only. |

`sendInvite` accepts `{ createdInviteId, inviteTokenPreview }` from preparation or
only `{ createdInviteId }` for a later attempt. The latter uses JSKIT's existing
opaque token-hash encoding without rotating the token. Empty or mismatched tokens
reject. Email, role, expiry and workspace display fields come from stored records.
The response includes
`createdInviteId`, `inviteTokenPreview`, `inviteUrl` and `inviteDelivery` alongside
the ordinary workspace/invitation-list payload. Keep tokens and URLs out of logs,
diagnostics and administrative receipts; save the invitation ID in the receipt.

### Preparation, association, commit and controlled delivery

The acceptance participant comes from a small application feature that provides
`workspaces.invite-acceptance-participant` and requires only what its writes need.
It cannot require `workspaces.core`, which receives it. In this example,
`reviewedPeople`, `people`, `scopes` and `audit` are application services. Each
forwards the supplied transaction to its repositories.

```js
// An application feature providing "workspaces.invite-acceptance-participant":
setup: ({ reviewedPeople, people, scopes, audit }) => ({
  inviteAcceptanceParticipant: async ({ invite, user }, options) => {
    // Resolve from the exact validated invitation, never a client person ID.
    const association = await reviewedPeople.resolveInvitation(invite.id, options);
    if (association.kind === "ordinary") return;
    await reviewedPeople.requireCurrentReview(association, {
      workspaceId: invite.workspaceId,
      user,
      roleSid: invite.roleSid
    }, options);
    await people.linkAccountAndTraining(association.personId, user.id, options);
    await scopes.applyReviewedAccess(association, user.id, options);
    await audit.recordInvitationAcceptance(association, user.id, options);
  }
})

// Inside an authorized application command, in a feature that requires
// workspaces: "workspaces.core" and workspaceRecords: "workspaces":
const { members } = workspaces.services;
const invites = workspaces.repositories.workspaceInvites;
const prepared = await invites.withTransaction({ context }, async (txOptions) => {
  // Match acceptance's order: workspace, then application draft/receipt rows.
  await workspaceRecords.lock(workspace.id, txOptions);
  const reviewed = await reviewedPeople.lockAuthorizedDraft(draftId, workspace.id, actor, txOptions);
  const receipt = await reviewedPeople.findMatchingReceipt(reviewed, requestId, txOptions);
  if (receipt) return { createdInviteId: receipt.inviteId };
  const created = await members.prepareInvite(workspace, actor, {
    email: reviewed.email,
    roleSid: reviewed.roleSid
  }, txOptions);
  await reviewedPeople.associateInvitationAndSaveReceipt(reviewed, requestId, created.createdInviteId, txOptions);
  return { createdInviteId: created.createdInviteId };
});

const result = await members.sendInvite(workspace, actor, prepared, { context });
// Store the delivery outcome, not the token or URL in result.
await reviewedPeople.recordDeliveryOutcome(prepared.createdInviteId, result.inviteDelivery, { context });
```

Lock the reviewed draft/receipt and reject changed input on a reused request ID.
After a lost preparation response, read the receipt instead of preparing another
invitation. Association failure rolls back the new invitation, replacement of
the previous invitation, receipt and application writes. Send only after the
transaction resolves successfully.

With no provider of `workspaces.invite-mailer`, delivery returns
`status: "mailer_unconfigured"`, an explanatory `message` and an empty
`providerMessageId`; the invitation remains committed. Provide a controlled
mailer in tests; SMTP is unnecessary:

```js
const inviteMailer = {
  async sendWorkspaceInvite(message) {
    capturedInvites.push(message); // Test-local memory; contains the secret link.
    return { status: "sent", message: "Captured by test mailer.", providerMessageId: "fixture-1" };
  }
};
```

Renderer/mailer exceptions return `inviteDelivery.status: "failed"` with a fixed
message to keep provider errors from exposing tokens. Persistence is unchanged.
Successful mailer results retain their normalized status, message, message
code and provider message ID; the default status is `sent`.

A provider may accept a message before throwing or losing its response. The
application must track delivery attempts and decide when to retry; email is not
exactly once. Revocation after sending starts cannot recall a message.

### Acceptance and failure semantics

Register one callback during feature setup to call the required application
services. Non-functions throw `TypeError`; duplicate registration throws, and
registration closes when acceptance/refusal first begins. The callback's invite,
user and options are shallow frozen. JSKIT owns the transaction and passes the
callback the `txOptions` that carry it and the request's `context`.

Acceptance checks authentication, recipient email, pending state and expiry under
workspace/invitation locks. Before calling the participant, it activates membership
with the stored invitation role, including when updating an existing membership.
The participant must use application data to check the review version, workspace,
current inviter authority, person eligibility, existing account link and scope
eligibility. Client input cannot authorize role or scope overrides.

An ordinary invitation without an application association may pass through.
Reject stale, revoked, conflicting or unexpectedly missing associations. Retain
enough review history to distinguish ordinary invitations from deleted associations.

Await every write with the same transaction and let failures propagate. The
callback must not commit, roll back, create transactions/savepoints or perform
external effects. Participant and later invitation-status failures roll back
membership (including its previous role/status), person/training links, scopes,
audit and accepted status. Invalid invitations and refusals do not call the
participant. Acceptance and refusal refuse to run inside the caller's
transaction; revocation can join one or open its own.

Acceptance/refusal return 401 for unauthenticated access, 403 for a recipient
email mismatch and 404 for a missing or handled invitation. A matching recipient's
expired invitation is revoked and committed before returning 409 with
`transactionOutcome: "committed"`, without activating membership or calling the
participant. A failed revocation commit retains its transaction error. Delivery
returns 404 for missing, foreign or handled invitations, 409 for expiry and 400
for a token mismatch.

Preserve `error.transactionOutcome` and `error.cause`: `rolledBack` confirms
rollback, `committed` can accompany a failed completion hook, and `unknown`
requires resolving the outcome before retrying. Errors after commit cannot undo
persistence. See
[managed transaction guidance](./existing-application-migration.md#data-access-on-table-resources-json-rest-api-3).

Invitation mutations lock workspace before invitation rows. A losing acceptance,
refusal, revocation or replacement cannot overwrite accepted/revoked state.
Replacement can create a new pending invitation after acceptance while retaining
the accepted invitation. Keep callbacks short: invitation changes in one workspace
serialize. Deadlocks/serialization failures propagate without replaying callbacks.

### Workspace creation participation

Provide the optional `workspaces.workspace-created-participant` capability the
same way, from a small application feature, to write application records for
every new workspace in the same transaction. Both creation paths call
`fn({ workspace, owner }, txOptions)`: the `workspace.workspaces.create` action
(`createWorkspaceForAuthenticatedUser`) and a personal workspace's provisioning
(`ensurePersonalWorkspaceForUser`, which joins its caller's transaction, such as
a first sign-in's profile sync). It runs after the workspace, its owner's
membership and its settings are written, so it can read them with `txOptions`.
`workspace` and `owner` are shallow frozen. Pass `txOptions` to every write and
let failures propagate: a failure rolls back the whole creation, workspace,
membership, settings and the participant's own writes, and the caller receives
the failure itself (an `AppError` answers as that refusal). Keep external effects
out of it. An existing personal workspace is not created again and does not call
it, and a create that loses its slug to the same owner's identical create answers
that workspace without calling it a second time.

### Compatibility and verification

Since `@jskit-ai/workspaces-core@0.1.198`, transactional `createInvite` callers
must use preparation followed by delivery after commit. Move related acceptance
writes into the participant. `markAcceptedById` and `revokeById` reject missing
or handled invitations. Route/action IDs, package exports and schema are unchanged.

Test through the normal redeem action: ordinary invitations, rollback after
application and final status writes, existing membership restoration, invalid
recipients/associations, controlled delivery failures and lost-response receipts.
The package fixture tests competing acceptance, refusal, revocation and replacement
in both winning orders on independent MySQL/MariaDB and PostgreSQL connections.
SQLite skips those races.

Use only a verified empty disposable database named
`jskit_repository_test_*` for native tests. The runner verifies the actual target,
reports its engine version, applies package migrations and drops fixture tables.

```sh
npx jskit test packages/workspaces-core/test/*.test.js
# Set JSKIT_REPOSITORY_TEST_DATABASE_URL to the verified empty disposable target.
npx jskit test packages/workspaces-core/test/repositories.integration.test.js
npm run verify
```

Run the application's `npm run jskit:update`, restart its backend and verify that
`members.prepareInvite` and `members.sendInvite` are functions on the installed
`workspaces.core` capability, and that the application feature providing
`workspaces.invite-acceptance-participant` is installed. The first release containing this contract pairs
`@jskit-ai/workspaces-core@0.1.198`, `@jskit-ai/jskit-catalog@0.1.245` and
`@jskit-ai/agent-docs@0.1.192`. Upgrade the coordinated dependency graph, then run
the application's identity, training, permission, privacy and browser tests.

## Browser composition

Use `workspaces/workspace-surfaces` for workspace selection, invitation landing,
member administration, settings, not-found states, and semantic shell
placements.

The route slug, selected workspace, query keys, and server scope stay aligned.
Invalid workspace URLs show a deliberate not-found/forbidden state instead of
silently selecting another workspace. The browser waits for the server's answer
about an unknown slug before deciding, so the surface can show that state.

### Surfaces and where `/` lands

Workspace surfaces put the slug in their pages root, such as
`pagesRoot: "w/[workspaceSlug]"` with `requiresWorkspace: true`, and
`w/[workspaceSlug]/admin` for administration. Keep the default surface
(`surfaceDefaultId`, usually `home`) free of a workspace requirement: `/`,
invitation links and other unscoped pages belong to it. With
`webRootAllowed: "no"`, `/` opens that surface's root. The foundation
defines `home` and its `public` access policy, and the `auth/auth-surface`
pattern the `auth` surface; the workspace surfaces add a policy and two
definitions:

```js
// config/surfaceAccessPolicies.js
surfaceAccessPolicies.workspace_member = { requireAuth: true, requireWorkspaceMembership: true };

// config/public.js
config.surfaceDefinitions.app = {
  id: "app",
  label: "App",
  pagesRoot: "w/[workspaceSlug]",
  requiresAuth: true,
  requiresWorkspace: true,
  accessPolicyId: "workspace_member"
};
config.surfaceDefinitions.admin = {
  id: "admin",
  label: "Admin",
  pagesRoot: "w/[workspaceSlug]/admin",
  requiresAuth: true,
  requiresWorkspace: true,
  accessPolicyId: "workspace_member"
};
```

An access policy takes `requireAuth`, `requireWorkspaceMembership`,
`requireAnyPermissions` and `requireAllPermissions` (permission lists), and
`requireFlagsAny` and `requireFlagsAll` (flags the server's bootstrap sets in
`surfaceAccess`). Without `requireAuth` or `requireWorkspaceMembership` it
takes the surface's `requiresAuth` or `requiresWorkspace`. The browser applies
the whole policy; the server reads only `requireWorkspaceMembership: false`
from it, and a route's own `auth` and `permission` authorize it there.

`workspaces-web` remembers the last workspace each person opened in this
browser. The **Your workspaces** page, `WorkspacesClientElement` from
`@jskit-ai/workspaces-web/client/components/WorkspacesClientElement`, uses it:

1. With pending invitations, it shows them so the person can join or refuse.
2. Otherwise it opens the last workspace used in this browser, if the person is
   still a member, or their only workspace.
3. Otherwise it lists their workspaces and, when they have none and
   `allowSelfCreate` is on, offers to create the first one.

The page sends signed-out visitors to sign in. The
`workspaces/workspace-surfaces` pattern mounts it at `/home/workspaces`. The
product decides where people land: keep a public landing page at `/home` that
links signed-in people there, or mount the page at `/home` itself so everyone
goes straight to sign-in or into their workspace. Applications may replace it
with their own page.

Loading uses skeletons; mutation errors use toasts. Warm-cache and browser
back/forward navigation must restore the correct workspace context.

## Verification

Test create/list/select, each role boundary, invitations and expiry,
cross-workspace isolation, invalid routes, direct URLs, switching, browser
back/forward, and responsive navigation.

Do not authorize from client state, add unscoped queries, or preserve old
tenancy setup through compatibility shims.
