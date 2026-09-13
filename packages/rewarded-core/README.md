# @jskit-ai/rewarded-core

Server runtime for Rewarded unlock gates.

## Package Shape

This package installs:

- four CRUD-owned server providers, one per persisted table
- one workflow provider for the rewarded gate API

The persisted tables are:

- `rewarded_rules`
- `rewarded_provider_configs`
- `rewarded_watch_sessions`
- `rewarded_unlock_receipts`

The package keeps the CRUD ownership strict:

- rules and provider configs are `workspace`-owned
- watch sessions and unlock receipts are `workspace_user`-owned

Every owned row carries direct owner columns. The module does not rely on inherited ownership through parent joins.

## What It Does

The workflow provider exposes four workspace-scoped app routes:

- `GET /api/w/:workspaceSlug/rewarded/current`
- `POST /api/w/:workspaceSlug/rewarded/start`
- `POST /api/w/:workspaceSlug/rewarded/grant`
- `POST /api/w/:workspaceSlug/rewarded/close`

These are plain workflow endpoints, not CRUD JSON:API endpoints.

The flow is:

1. `current` decides whether the gate is enabled, blocked, or already unlocked.
2. `start` creates a watch session when a reward is required.
3. `grant` marks the session rewarded and creates an unlock receipt.
4. `close` closes a started session without granting access.

Day 0 is intentionally app-surface-only for the rewarded workflow. Rules and provider configs should therefore use `surface = "app"` for the active gate rows.

## Required Data

Day-0 configuration lives in the CRUD-owned tables.

At minimum, apps need:

- a `rewarded_rules` row for the target `gateKey`
- a matching enabled `rewarded_provider_configs` row for the surface

Important config fields:

- `rewarded_rules.gate_key`
- `rewarded_rules.surface`
- `rewarded_rules.unlock_minutes`
- `rewarded_rules.cooldown_minutes`
- `rewarded_rules.daily_limit`
- `rewarded_provider_configs.surface`
- `rewarded_provider_configs.placement`
- `rewarded_provider_configs.provider`

The application selects `provider` and `placement` for its delivery adapter.
The workflow does not interpret them or choose a default provider. For the
Google application pattern use `provider = "google-publisher-tag"` and the ad unit
path as `placement`.

## Protecting Server Features

Protected server mutations should use the exported helper:

```js
import { requireRewardedUnlock } from "@jskit-ai/rewarded-core/server/requireRewardedUnlock";
```

The dedicated manual page is:

- [docs/protecting-server-actions.md](docs/protecting-server-actions.md)

That page shows the exact service and provider wiring pattern.

## Grant authorization

The application must supply capability `rewarded.grant-policy` with an
`authorizeGrant({ session, context, trx })` function. Direct service composition
supplies the same function as `authorizeGrant`. Missing policy fails at setup;
only the literal result `true` permits a grant. False, absent or other results
reject it before any watch-session update or receipt creation.

The workflow loads the session through its owned repository, then passes that
stored session, the server request context and the current transaction to policy.
It never accepts a client approval flag or replacement gate identity. The policy
runs for repeated grant requests too. Keep policy local and bounded within the
transaction; use the application's trusted eligibility or verification records.
A policy exception propagates as failure rather than silently allowing a grant.

The Google browser pattern supplies delivery only. Its callbacks are not a
server authorization implementation. The application must decide which reward
claims it accepts; the library supplies neither provider-proof verification nor
a permissive default.

## Policy Model

This module is designed for rewarded unlocks, not for blocking all normal app use on boot.

Recommended usage:

- unlock bonus actions
- unlock extra quota
- unlock a temporary feature window

Do not treat it as a hard requirement for baseline product use unless the ad provider policy clearly allows that.

## Install Notes

The package declares its four initial schema migrations under `migrations/`.
Run them through the application's existing database migration operation.

The package does not add day-0 settings pages automatically. Configuration can stay manual or be layered with app-specific UI later.

## Manual V0 migration

Replace `@jskit-ai/google-rewarded-core` with `@jskit-ai/rewarded-core` and
`@jskit-ai/google-rewarded-web` with `@jskit-ai/rewarded-web`. Update imports
(`requireRewardedUnlock`, `createRewardedRuntime`, `useRewardedRuntime`),
`Rewarded*` provider names, `rewarded.*` server capabilities, `client.rewarded`
and `/api/w/:workspaceSlug/rewarded/*` routes. Register application-owned
`client.rewarded-delivery` and `rewarded.grant-policy` providers as described
in these packages. There is no implicit grant approval for older apps.

For disposable prerelease data, recreate the four tables through the new
migrations. If retaining data, stop writers, back up the database and manually
rename each `google_rewarded_*` table to `rewarded_*`, preserving IDs, owner
columns and foreign-key relationships. In the provider configuration table,
rename `ad_unit_path` to `placement` and replace `script_mode` with required
`provider` values chosen for the application; existing GPT rows use
`google-publisher-tag`. Remove the old column/default. Reconcile the application's
migration records so initial table creation is not replayed against retained
schema; verify indexes, constraints and ownership with its database tools before
resuming writers. Decide explicitly whether to retain active watch sessions and
unlock receipts. No library migration shim, alias, old-table reader or dual write
performs this conversion.
