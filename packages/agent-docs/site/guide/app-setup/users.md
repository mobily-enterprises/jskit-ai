# Users

Authentication proves an identity. `@jskit-ai/users-core` gives that identity a
persistent application profile and settings model; `@jskit-ai/users-web`
provides self-service account UI.

```bash
npm install @jskit-ai/users-web
npm run db:migrate
```

The installed graph supplies the required users runtime, storage, uploads,
database, HTTP, and auth integration. The application must already have one
database driver and one auth provider selected.

Package-owned user migrations are discovered directly from the installed
graph. `npm run db:migrate` is the application-owned Knex command that applies
them.

## Self-service accounts

Use the `users/account-settings` pattern for profile, preference, and
notification sections. Decide which fields are editable and which operations
require reauthentication.

The sections are pages in Material 3's list-detail layout: `/account` lists
them (`src/pages/account/index.vue`) and `/account/<section>` opens one
(`src/pages/account/[section].vue`, whose parent is the list, `"/"`). A phone
shows the list or one section, with Up from the section back to the list; a wide
window shows the list beside the open section. Link to a section by its path,
such as `/account/preferences`.

Use the framework account settings elements and command composables rather than
new page-local request clients. Cached query data must hydrate editable fields
immediately; clearing a value must send the clear operation rather than omit the
field.

Loading uses layout-stable skeletons. Mutation errors use a toast, not an
in-page banner that moves the form.

## User administration

Use `users/user-administration-server` only when the product needs global or
workspace-scoped administration beyond self-service settings. It demonstrates
an app-owned feature package built with `defineCrudJsonApiFeature()` on a CRUD
contract over users-core's `userProfileResource`, while keeping profile
persistence, and the `users` table's one table resource, in `users-core`.

Do not expose password hashes, provider credentials, or session data through
the CRUD contract. Apply permission and workspace scope before repository access so
record existence is not leaked.

## Verification

Test profile creation from an authenticated identity, read/update/clear flows,
warm-cache navigation, the section list and a section one at a time at 390 px
(Up returns to the list) and side by side at 1280 px, uploads when enabled, forbidden administration, missing
records, pagination, and workspace isolation where relevant.

Do not copy users-core tables or services into the application. Do not add
field questionnaires, generated-file markers, migration copies, or receipts.
