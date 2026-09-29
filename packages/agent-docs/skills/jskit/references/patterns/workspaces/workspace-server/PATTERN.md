---
id: workspaces/workspace-server
title: Workspace tenancy server composition
summary: Configure roles, workspace access policy, invitations, and app-owned invitation email rendering around JSKIT workspace runtime APIs.
keywords: access, invite, membership, multitenancy, policy, role, tenancy, workspace
requires: @jskit-ai/workspaces-core, @jskit-ai/users-core
---

# Workspace tenancy server composition

## Use when

Use this pattern when records, routes, or navigation belong to a selected
workspace and membership or role affects access.

## Do not use when

Do not use workspace tenancy for a genuinely single-owner product or as a
substitute for a simpler domain ownership column.

## Product decisions

Choose workspace creation policy, roles, invitation policy, expiry, email copy,
member permissions, personal-workspace behavior, and surface access rules.

## Framework APIs

Use workspace routes, resources, scope helpers, tenancy profiles, and settings
contracts exported by `@jskit-ai/workspaces-core`.

## Transactional invitation participation

Use the existing `workspaces.core` capability. During application feature setup,
register one callback with
`workspaces.services.pendingInvitations.registerAcceptanceParticipant(fn)`.
The built-in `workspace.invite.redeem` action invokes
`fn({ invite, user }, { trx, context })` after recipient/state/expiry validation
and membership activation inside the same uncommitted managed transaction.
Forward `trx` to every application owner; throw on invalid reviewed associations
or failed writes. The framework marks accepted and commits only after success.
Do not perform external effects or complete the transaction in the participant.
Non-functions, duplicate registrations and registrations after acceptance/refusal
begins reject. Ordinary invitations can pass through without an association;
expected-but-missing, stale, revoked or conflicting associations must fail closed.

For deliberate invitation creation, use `members.prepareInvite(workspace, actor,
payload, { trx, context })` in `repositories.workspaceInvites.withTransaction`
or the same JSON REST API's managed `transaction`. It returns
`{ createdInviteId, inviteTokenPreview }` without delivery. Lock the workspace
with `repositories.workspaceInvites.lockWorkspaceForInvitations(workspace.id,
{ trx })` before application draft/receipt rows, and save the exact invitation
association and retry receipt before commit. Failed association restores any
prior pending invitation. A draft of intended access should not call preparation.

After confirmed commit, call `members.sendInvite(workspace, actor, prepared,
{ context })`. A later attempt can pass only `{ createdInviteId }`. Delivery
reloads the committed pending invitation and uses stored recipient/role/expiry;
it does not replace the invitation. Its `inviteDelivery` is separate from
persistence: `mailer_unconfigured` when no mailer is supplied, `failed` on a
renderer/mailer exception, or the normalized controlled/provider result.
Interruption or failure may still mean a provider accepted the message. Receipt
idempotency and delivery retries are application-owned; email is not exactly once.
Do not log the returned token/URL. No SMTP setup is required for testing.

`createInvite`, acceptance and refusal now own managed transactions and reject
borrowed `options.trx`. Move transactional creation to preparation/post-commit
sending and acceptance-related writes into the participant. Revocation may join
a managed transaction. Raw Knex/savepoint transactions cannot own resource
writes. Invitation mutations lock workspace then invitation rows, revalidate
current state and reject attempts to overwrite terminal state. Matching-recipient
expiry rejection commits revocation before returning 409. Preserve transaction
outcomes and causes; a completion-hook error after commit cannot undo writes.

See the human guide's **Workspace tenancy → Transactional invitation
participation** for the full consumer example, errors, controlled mailer,
compatibility notes and native verification commands. Application services still
own authorization, identity/training linking, reviewed scope eligibility and
required audit. This seam adds no application domain tables or policy.

## Invariants

- Workspace membership and role are checked before scoped application actions.
- Role ids are stable product vocabulary shared by server and client config.
- Invitation tokens remain secret; emails receive only the intended link.
- Workspace scope reaches repository queries, not just route parsing.
- Package-owned migrations run directly from the installed package graph.

## Example files

`example/config/roles.js` is a concrete role catalogue.
`example/packages/main/src/server/email/workspaceInviteEmail.js` demonstrates an
app-owned invitation renderer. Compose both through normal application config.

## Variation points

Change roles, invitation policy and copy, defaults, access policies, surface
ids, and product-specific workspace settings.

## Verification

Test create/list/select, member and non-member access, each role boundary,
invitation expiry/redemption, cross-workspace isolation, and email output.

## Avoid

- synthetic membership workarounds
- authorizing from client navigation state
- embedding invitation templates or secrets in package metadata
- source-appending install commands
