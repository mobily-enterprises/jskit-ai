---
id: users/user-administration-server
title: User administration server package
summary: Expose user administration and workspace-scoped member operations through app-owned packages backed by JSKIT users runtime APIs.
keywords: account, admin, member, repository, resource, routes, service, user, workspace
requires: @jskit-ai/users-core, @jskit-ai/crud-core
---

# User administration server package

## Use when

Use this pattern when an application needs app-specific administration of user
profiles or workspace members beyond the built-in account runtime.

## Do not use when

Do not use this pattern for self-service account settings, authentication
credentials, or an application that needs no administrative user listing.

## Product decisions

Choose global versus workspace scope, visible and editable fields, permission
policy, route surface, filters, and whether account deletion is part of the
product. Do not expose password, session or sign-in identity data through the
CRUD contract.

## Framework APIs

Use `@jskit-ai/users-core` for profile persistence and policies,
`defineCrudFeature()` from `@jskit-ai/crud-core` for standard mechanics,
and the resource contracts from `@jskit-ai/resource-crud-core`.

users-core is the `users` table's one owner, so an administration feature does
not own it: `defineCrudFeature({ crud: userCrud, ownerRepository: "users.profiles", ... })`
serves the CRUD contract through users-core's repository. The workspace
variant also names `visibility: "workspace"`: its routes are a workspace's,
so they resolve the caller's workspace and check its `crud.users.*`
permissions, while the users it lists are every user, as the table's
ownership says.

The `users` table has one table resource, users-core's `userProfileTableResource`
(`@jskit-ai/users-core/shared/resources/userProfileResource`). An
administration package never defines a second one; `jskit check` fails a table
with two. It builds its CRUD contract on that resource,
`defineCrudContract(userProfileTableResource, { namespace, operations, fields })`,
which chooses the operations, their namespace and the fields each returns; a
field the contract keeps out of every operation gets an empty entry (`{}`). The
list searches with the resource's `q` filter: every word in the display name,
email or username.

Other code that reads or writes the users' records (a decorated service, a
hook, a job) requires their owners' capabilities, never the `users` or
`user_settings` tables:

- `users.profiles`: `findById`, `findByEmail`, `findByIdentity`,
  `listByEmails(emails, options)` (one read), `upsert`,
  `createWithSettings({ profile, settings }, options)` (the profile and its
  settings in one transaction; settings start from the defaults),
  `createWithId(profile, options)` (a profile keeping an earlier table's id),
  `createManyIgnoringExisting(profiles, options)` (a re-runnable bulk import,
  system context only), `changeUsername(userId, username, options)` and
  `countUsers({ excludeIds, createdSince, authProvider }, options)`.
- `users.settings`: `findByUserId`, `ensureForUserId` and the settings updates.

Their types are `UsersProfiles` and `UsersSettings` in
`@jskit-ai/users-core/server/types`. Every method takes `options` last and
joins the caller's transaction: inside `withTransaction(options, async
(txOptions) => …)`, pass `txOptions` to every call.

## Invariants

- The public user id is the resource identity.
- Workspace operations are scoped before repository access.
- Permission checks happen before records or record existence are disclosed.
- Shared profile persistence remains owned by `@jskit-ai/users-core`, and so
  does the `users` table's one table resource.
- The CRUD contract is the field contract; the feature projects its repository,
  service, actions, and routes without app-local ceremony.
- Each package exports the type of the capability it provides:
  `src/server/types.js` declares `AppUsers` (for `app.users`) or
  `AppUsersWorkspace` (for `app.users-workspace`) as crud-core's
  `CrudResourceApi`, exported as `./server/types`. A feature that requires the
  capability names that type in a JSDoc `@param`.
- Code added to a declaration follows [typed features](https://github.com/mobily-enterprises/jskit-ai/blob/main/packages/agent-docs/site/guide/framework/typed-features.md):
  decorators, lifecycle hooks and named actions call the collaborators they
  receive directly, with no `typeof` probe, optional call, absent default,
  slot setter or module-level registry, and each action's `execute` is one
  call to one service method with the validated input. Keep one copy of each
  helper per package, files under 750 lines and functions under 600.

## Example files

`example/packages/users/` is a global administration package.
`example/packages/users-workspace/` demonstrates the workspace route/action
boundary, with workspaces-core's `WORKSPACE_CRUD_SCOPE`, while reusing the same
service contract. Each package's `src/shared/userCrud.js` builds its CRUD
contract on users-core's `userProfileTableResource`, its `package.json` requires
`users.profiles` (users-core, which owns the table, must be installed), and its
`src/server/types.js` declares the type of the capability it provides. Copy only the composition
that matches the product and adapt it as ordinary application source.

## Variation points

Change scope, route surface, visible fields, filters, sorting, permission
policy, and user-facing language. Retain the core user identity contract.

## Verification

Test authorized and forbidden list/view/update operations, cross-workspace
isolation, missing records, null/cleared fields, filtering, and pagination.

## Avoid

- a second table resource on `users` or `user_settings`
- copying authentication credential tables into the CRUD contract
- trusting route scope without repository scope
- adding app-local mechanics already provided by `defineCrudFeature()`
- generator metadata or field questionnaires
- probing a collaborator, defaulting one to `null`, `{}` or a no-op, setters
  that fill a slot after construction, and module-level registries
