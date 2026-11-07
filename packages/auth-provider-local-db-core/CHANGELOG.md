# Changelog

## Unreleased

- New owner capabilities, provided by `AuthLocalDatabaseBackendProvider` beside `auth.local.backend`, for application code that works with local auth's records: `auth.local.accounts` (`create`, `findByEmail`, `updatePassword`, `updateProfile`, `markEmailVerified`), `auth.local.sessions` (`create`, `revoke`, `revokeForUser`, `deleteExpired`) and `auth.local.recovery` (`create`, `findByTokenHash`, `consume`, `consumeForUser`). Each method takes `options` last and runs in `options.trx` when there is one. Their types are `AuthLocalAccounts`, `AuthLocalSessions` and `AuthLocalRecovery` in the new `./server/types`; `./server/lib/index` also exports `createLocalDbOwners`.
- `markEmailVerified(userId, options)` records that the account proved it owns its email address, keeping the first proof, and answers the account; account records answer `emailVerifiedAt` (empty until then). The new migration `auth_local_db_users_email_verified` adds the nullable `email_verified_at` column to `auth_local_users` when it is missing.
- `deleteExpired(now, options)` deletes the sessions that expired by `now` and answers how many.

### Upgrading

- Run `npm run db:migrate`. An application that added `email_verified_at` itself keeps its column (the migration leaves an existing one alone) and replaces its own writes with `markEmailVerified`.
