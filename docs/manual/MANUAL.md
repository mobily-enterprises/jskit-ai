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


## Sequence

```
  npx jskit add bundle auth-supabase --no-install
  npx jskit add bundle auth-base --no-install
  npm install
  npm run web-shell:generate
  npm run dev
  npm run server
```



```txt
npx jskit add bundle --no-install api-foundations

```txt
api-foundations
web-shell
auth-base
auth-supabase
db-mysql
workspace-core
workspace-console
assistant
assistant-openai
chat-base
social-base
users-profile
observability-base
billing-base
billing-stripe
realtime

npx jskit add bundle --no-install <id>
npx jskit doctor
npm install
npx jskit doctor
```




## 4) Install Framework Packs (real use)

From `manual-app`:

```bash
npm run jskit -- list
```

Recommended baseline:

```bash
npm run jskit -- add bundle web-shell --no-install
npm run jskit -- add bundle db-mysql --no-install
npm run jskit -- add bundle auth-base --no-install
npm install
npm run jskit -- doctor
```

Notes:
- `db` currently adds concrete files (`knexfile.cjs`, `migrations/*`, `seeds/*`) and db scripts.
- Other packs currently contribute package/runtime dependencies and lock ownership.

## 5) Next Step: Progressive Enrichment (no install yet)

Use this sequence to stage a broad feature set into the app while keeping dependency install deferred:

```bash
npx jskit add bundle saas-full --no-install
npx jskit add bundle community-suite --no-install
npx jskit add bundle web-shell --no-install
npx jskit add bundle communications-base --no-install
npx jskit add bundle realtime --no-install
npx jskit add bundle workspace-admin-suite --no-install
npx jskit add bundle ops-retention --no-install
npx jskit add bundle security-audit --no-install
npx jskit add bundle auth-supabase --no-install
npx jskit add bundle billing-paddle --no-install
npx jskit add bundle db-mysql --no-install
```

What each one does (briefly):

- `saas-full`: Adds a large baseline SaaS stack (auth, assistant, billing, observability, workspace core pieces).
- `community-suite`: Adds chat + social + user profile community features.
- `web-shell`: Scaffolds filesystem-driven shell host files (`src/pages/**`, `src/surfaces/**`, drawer/top/config menus) and wires generated TanStack routing.
- `communications-base`: Adds communications core plus email/sms adapters.
- `realtime`: Adds realtime contracts, server socket layer, and client runtime.
- `workspace-admin-suite`: Adds admin/console workspace adapters and settings/console endpoints.
- `ops-retention`: Adds retention and redis-oriented operational helpers.
- `security-audit`: Adds security audit core and persistence adapter package wiring.
- `auth-supabase`: Adds Supabase auth provider integration on top of auth core.
- `billing-paddle`: Adds Paddle billing provider integration on top of billing core.
- `db-mysql`: Adds MySQL db provider wiring plus `knexfile`, migration, and seed scaffolding.

Notes:
- Keep `--no-install` for each command while staging changes.
- These packs overlap in places; this is intentional for fast convergence, but it is not the minimal set.
- After adding `web-shell`, routes/menus are generated from filesystem files via:
  - `npm run web-shell:generate`
  - (`dev`/`build` scripts already run this automatically when `web-shell` is installed)

### Web-Shell Injection (Package Level)

When a package needs to materialize UI/navigation, have it mutate real files into:

- `src/pages/<surface>/**` (path is route)
- `src/surfaces/<surface>/{drawer|top|config}.d/*.entry.js` (menu slots)

Packages can declare UI element availability and optional materialization in their descriptor metadata.
Use `npx jskit show <id>` to see the element’s routes, shell entries, file drops, and text mutations before applying.

Then run:

```bash
npm run web-shell:generate
```

This updates `src/shell/generated/filesystemManifest.generated.js`, which is what the shell router and menus consume.

Optional guard hook:

- Define `globalThis.__JSKIT_WEB_SHELL_GUARD_EVALUATOR__ = ({ guard, phase, context }) => ...`
- The same evaluator is used for route gating and menu visibility.

## 6) DB Architecture (Current)

- Feature modules depend only on `@jskit-ai/jskit-knex`.
- Dialect/provider selection happens via bundle choice: `db-mysql` or `db-postgres`.
- Do not import dialect packages directly in feature modules.

Example:

```bash
npx jskit add bundle web-shell --no-install
npx jskit add bundle assistant-openai --no-install
npx jskit add bundle db-postgres --no-install
npx jskit add bundle assistant --no-install
npm install
npx jskit doctor
```
## Duplication Guardrail (CI)

A duplication guardrail is wired into CI using `jscpd` with a baseline. The baseline allows existing duplication to pass, and CI fails only when new duplicated fragments are introduced.

How it works:
1. `jscpd` scans the repo using `.jscpd.json`.
2. The current report is compared to `.jscpd/baseline.json`.
3. CI fails if new duplicate pairs appear beyond the baseline.

Generate or refresh the baseline:

```bash
npx jscpd --config .jscpd.json --reporters json --output .jscpd
cp .jscpd/jscpd-report.json .jscpd/baseline.json
```

Run locally:

```bash
npm run lint:duplication
```
