---
title: Vibe Guide
description: "Two reproducible JSKIT starting points: a workspace-enabled app and a simple app."
---

# Vibe Guide

This page gives you two reproducible starting points.

- Use the first track if you want the full workspace-enabled app shape.
- Use the second track if you want a simpler app with no workspace tenancy.

Both tracks assume you are comfortable running commands in a terminal and filling in real values for your own database, Supabase project, and assistant key.

## Shared values

Both tracks use the same placeholder variables:

```bash
OPENAI_API_KEY=...
SUPABASE_URL=...
SUPABASE_KEY=...
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=testapp
DB_USER=...
DB_PASSWORD=...
```

## Track 1: Workspace-enabled app

Use this if you want:

- personal workspaces
- the `app` and `admin` workspace surfaces
- the workspace settings area
- the admin cog menu
- the `admin` assistant configured from `console`

```bash
npx @jskit-ai/create-app testapp --tenancy-mode personal
cd testapp
npm install

npx jskit add package shell-web

npx jskit add package auth-provider-supabase-core \
  --auth-supabase-url "$SUPABASE_URL" \
  --auth-supabase-publishable-key "$SUPABASE_KEY" \
  --app-public-url "http://localhost:5173"

npx jskit add bundle auth-base

npx jskit add package database-runtime-mysql \
  --db-host "$DB_HOST" \
  --db-port "$DB_PORT" \
  --db-name "$DB_NAME" \
  --db-user "$DB_USER" \
  --db-password "$DB_PASSWORD"

npx jskit add package users-web
npx jskit add package console-web
npx jskit add package workspaces-core
npx jskit add package workspaces-web

npx jskit generate assistant setup \
  --surface admin \
  --settings-surface console \
  --config-scope global \
  --ai-provider openai \
  --ai-api-key "$OPENAI_API_KEY"

npx jskit generate assistant page \
  w/[workspaceSlug]/admin/assistant/index.vue \
  --name "Assistant"

npx jskit generate assistant settings-page \
  console/settings/admin-assistant/index.vue \
  --surface admin \
  --name "Admin Assistant" \
  --link-placement console-settings:primary-menu \
  --link-component-token local.main.ui.surface-aware-menu-link-item

npm install
npm run db:migrate
```

This gives you:

- `/console`
- `/w/[workspaceSlug]`
- `/w/[workspaceSlug]/admin`
- `/w/[workspaceSlug]/admin/assistant`
- `/console/settings/admin-assistant`

If this is the track you want, read [Quickstart](/guide/app-setup/quickstart) next. That chapter shows how to add workspace settings pages, admin cog entries, and normal left-menu pages.

## Track 2: Simple app

Use this if you want:

- no workspace tenancy
- no workspace settings area
- no workspace admin cog
- a smaller route and surface model

```bash
npx @jskit-ai/create-app testapp --tenancy-mode none
cd testapp
npm install

npx jskit add package shell-web

npx jskit add package auth-provider-supabase-core \
  --auth-supabase-url "$SUPABASE_URL" \
  --auth-supabase-publishable-key "$SUPABASE_KEY" \
  --app-public-url "http://localhost:5173"

npx jskit add bundle auth-base

npx jskit add package database-runtime-mysql \
  --db-host "$DB_HOST" \
  --db-port "$DB_PORT" \
  --db-name "$DB_NAME" \
  --db-user "$DB_USER" \
  --db-password "$DB_PASSWORD"

npx jskit add package users-web
npx jskit add package console-web

npm install
npm run db:migrate
```

This gives you a smaller app with:

- the normal `home`, `account`, `auth`, and `console` surfaces
- Supabase-backed login
- database runtime
- no workspace-aware `app` or `admin` surfaces

That last point matters. In a `tenancyMode = "none"` app there is no workspace settings area and no workspace admin cog, so the workspace-specific commands from the Quickstart chapter do not apply to this track.

## Which one should you pick?

Pick the workspace-enabled track if you know the app needs:

- personal or shared workspaces
- workspace settings
- an `admin` surface
- workspace-specific app pages

Pick the simple track if you want:

- the smallest app shape
- no workspace routing
- fewer surfaces to reason about

If you are unsure, pick the workspace-enabled track. It is the one the rest of the hands-on Quickstart flows assume.

## After bootstrap: keep the app sane

If you are going to hand the repo to an AI agent and let it iterate, keep these rules explicit from day one.

### 1. Use JSKIT commands first, not hand-made topology

- Install baseline capabilities with `jskit add package ...` and `jskit add bundle ...`.
- For substantial non-CRUD backend work, scaffold a real feature package with `jskit generate feature-server-generator scaffold <feature-name>`.
- For CRUDs, use the CRUD generators instead of hand-building routes, services, and forms from scratch.

If the agent starts inventing file layouts or wiring patterns that JSKIT already has a command for, stop and redirect it back to the CLI.

### 2. Keep `packages/main` boring

`packages/main` should stay glue-only:

- app composition
- shell wiring
- config loading
- provider registration

Substantial domain logic should live in its own local package under `packages/<feature>/`.

If the agent starts adding feature-sized server code directly under `packages/main`, that is drift, not progress.

### 3. Write down the shape before the churn starts

For anything beyond a tiny tweak:

- create or update `.jskit/APP_BLUEPRINT.md`
- create or update `.jskit/WORKBOARD.md`
- work one reviewable chunk at a time

That keeps the agent from mixing platform setup, routing decisions, CRUD generation, and business logic in one unreadable burst.

### 4. Make verification part of the loop, not the cleanup

Before accepting a chunk, run the real checks:

```bash
npm run verify
```

If the chunk changed user-facing UI, also run a targeted local Playwright flow and record it:

```bash
npx jskit app verify-ui \
  --command "npm run verify:ui" \
  --feature "<short label>" \
  --auth-mode <mode>
```

Then run:

```bash
npx jskit doctor --against origin/main
```

That gives `doctor` a concrete UI verification receipt tied to the branch delta, not just a vague claim that "the UI was tested."

### 5. Keep hosted CI simple unless you deliberately build more

The default sane baseline for hosted CI is still:

```bash
npm run verify
```

Do not assume GitHub Actions should automatically stand up browser auth, seeded data, and app-specific Playwright flows unless you intentionally built that infrastructure for the app.

### 6. Do not use live login flows for normal UI verification

For Playwright, prefer the app's local development auth bootstrap path such as `POST /api/dev-auth/login-as`.

- use seeded local users
- keep the browser flow deterministic
- do not depend on a real Supabase login page for normal feature verification

If the app has no good local auth bootstrap path yet, treat that as a testability gap and fix it early.

### 7. Watch for these drift signals

Stop and correct course if the agent starts doing things like:

- growing `packages/main` into a feature package
- hand-making a new server topology when a JSKIT generator exists
- changing UI without a recorded Playwright run
- bypassing `jskit doctor` because "it works locally"
- mixing data access, service logic, and UI behavior into the same file because it was faster

The point of vibe coding in JSKIT is not to remove structure. It is to move faster while keeping the structure machine-checkable.
