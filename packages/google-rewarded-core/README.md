# @jskit-ai/google-rewarded-core

Server runtime for Google rewarded unlock gates.

## Package Shape

This package installs:

- four CRUD-owned server providers, one per persisted table
- one workflow provider for the rewarded gate API

The persisted tables are:

- `google_rewarded_rules`
- `google_rewarded_provider_configs`
- `google_rewarded_watch_sessions`
- `google_rewarded_unlock_receipts`

The package keeps the CRUD ownership strict:

- rules and provider configs are `workspace`-owned
- watch sessions and unlock receipts are `workspace_user`-owned

Every owned row carries direct owner columns. The module does not rely on inherited ownership through parent joins.

## What It Does

The workflow provider exposes four workspace-scoped app routes:

- `GET /api/w/:workspaceSlug/google-rewarded/current`
- `POST /api/w/:workspaceSlug/google-rewarded/start`
- `POST /api/w/:workspaceSlug/google-rewarded/grant`
- `POST /api/w/:workspaceSlug/google-rewarded/close`

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

- a `google_rewarded_rules` row for the target `gateKey`
- a matching enabled `google_rewarded_provider_configs` row for the surface

Important config fields:

- `google_rewarded_rules.gate_key`
- `google_rewarded_rules.surface`
- `google_rewarded_rules.unlock_minutes`
- `google_rewarded_rules.cooldown_minutes`
- `google_rewarded_rules.daily_limit`
- `google_rewarded_provider_configs.surface`
- `google_rewarded_provider_configs.ad_unit_path`
- `google_rewarded_provider_configs.script_mode`

Day 0 assumes GPT rewarded ads for web, so `script_mode` should stay aligned with that flow.

## Protecting Server Features

Protected server mutations should use the exported helper:

```js
import { requireGoogleRewardedUnlock } from "@jskit-ai/google-rewarded-core/server/requireGoogleRewardedUnlock";
```

The dedicated manual page is:

- [docs/protecting-server-actions.md](/home/merc/Development/current/jskit-ai/packages/google-rewarded-core/docs/protecting-server-actions.md)

That page shows the exact service and provider wiring pattern.

## Policy Model

This module is designed for rewarded unlocks, not for blocking all normal app use on boot.

Recommended usage:

- unlock bonus actions
- unlock extra quota
- unlock a temporary feature window

Do not treat it as a hard requirement for baseline product use unless the ad provider policy clearly allows that.

## Install Notes

When an app adds this package, JSKIT installs the four schema migrations from `templates/migrations/`.

The package does not add day-0 settings pages automatically. Configuration can stay manual or be layered with app-specific UI later.
