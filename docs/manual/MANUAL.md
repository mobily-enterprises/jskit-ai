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
../jskit-ai/packages/tooling/create-app/bin/jskit-create-app.js manual-app --target . --force
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

## Reset Fast (repeatable scaffold loop)

From monorepo root (`jskit-ai`):

```bash
scripts/dev/reset-scaffold-app.sh /home/merc/Development/current/manual-app manual-app
```

Notes:
- Keeps `.git` if present and wipes everything else.
- Re-runs `npx @jskit-ai/create-app ... --target . --force`.
- Reinstalls dependencies by default (`INSTALL_DEPS=1`).
- Skip install for faster iteration: `INSTALL_DEPS=0 scripts/dev/reset-scaffold-app.sh ...`.

## 4) Install Framework Packs (real use)

From `manual-app`:

```bash
npm run jskit -- list
```



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

npx jskit add bundle <id> --no-install
npx jskit doctor
npm install
npx jskit doctor
```