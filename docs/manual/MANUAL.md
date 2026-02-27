# Manual App Scaffold (npx)

This is the exact flow used to scaffold a new app into an existing directory that already contains only `.git`.

## 1) Prepare target directory

```bash
mkdir -p manual-app
cd manual-app
git init
```

## 2) Scaffold into current directory

```bash
# ../jskit-ai/packages/tooling/create-app/bin/jskit-create-app.js manual-app --target . --force # LEAVE THIS IN FOR NOW
npx @jskit-ai/create-app manual-app --target .
```

Notes:
- `--template` is optional (`base-shell` is the default).
- `--initial-bundles` is optional (`none` is the default).
- A target directory containing only `.git` is treated as allowed (no `--force` required).
- If any other files/folders already exist, use `--force`.

## 3) Install and run

```bash
npm install
```

Terminal 1:

```bash
npm run dev
```

Terminal 2:

```bash
npm run server
```

Then open:

```text
http://localhost:5173
```

## 4) Install Framework Packs (real use)

From `manual-app`:

```bash
npm run jskit -- list
```

Recommended baseline:

```bash
npm run jskit -- add web-shell --no-install
npm run jskit -- add db --provider mysql --no-install
npm run jskit -- add auth-base --no-install
npm install
npm run jskit -- doctor
```

Notes:
- `db` currently adds concrete files (`knexfile.cjs`, `migrations/*`, `seeds/*`) and db scripts.
- Other packs currently contribute package/runtime dependencies and lock ownership.

## 5) Next Step: Progressive Enrichment (no install yet)

Use this sequence to stage a broad feature set into the app while keeping dependency install deferred:

```bash
npx jskit add saas-full --no-install
npx jskit add community-suite --no-install
npx jskit add web-shell --no-install
npx jskit add communications-base --no-install
npx jskit add realtime --no-install
npx jskit add workspace-admin-suite --no-install
npx jskit add ops-retention --no-install
npx jskit add security-audit --no-install
npx jskit add auth-supabase --no-install
npx jskit add billing-paddle --no-install
npx jskit add db --provider mysql --no-install
```

What each one does (briefly):

- `saas-full`: Adds a large baseline SaaS stack (auth, assistant, billing, observability, workspace core pieces).
- `community-suite`: Adds chat + social + user profile community features.
- `web-shell`: Adds shared web/runtime shell foundations (surface routing, web/http runtime, server runtime base).
- `communications-base`: Adds communications core plus email/sms adapters.
- `realtime`: Adds realtime contracts, server socket layer, and client runtime.
- `workspace-admin-suite`: Adds admin/console workspace adapters and settings/console endpoints.
- `ops-retention`: Adds retention and redis-oriented operational helpers.
- `security-audit`: Adds security audit core and persistence adapter package wiring.
- `auth-supabase`: Adds Supabase auth provider integration on top of auth core.
- `billing-paddle`: Adds Paddle billing provider integration on top of billing core.
- `db --provider mysql`: Adds MySQL db provider wiring plus `knexfile`, migration, and seed scaffolding.

Notes:
- Keep `--no-install` for each command while staging changes.
- These packs overlap in places; this is intentional for fast convergence, but it is not the minimal set.
