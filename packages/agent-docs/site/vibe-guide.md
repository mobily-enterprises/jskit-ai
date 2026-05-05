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
