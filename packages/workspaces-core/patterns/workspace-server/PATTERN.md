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
