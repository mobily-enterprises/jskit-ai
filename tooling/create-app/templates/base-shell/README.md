# __APP_TITLE__

Generated with `jskit-create-app` (template: `base-shell`).

## Quickstart

```bash
npm install
npm run dev
```

Refresh JSKIT dependencies to the latest published versions:

```bash
npm run jskit:update
```

Automate update + PR + merge release flow:

```bash
npm run release
```

## Server

```bash
npm run server
```

App configuration files:

- `config/public.js` for client-visible feature toggles, including surface definitions.
- `config/server.js` for server-only toggles/secrets wiring.

## Add Capabilities

```bash
npx jskit add package auth-provider-supabase-core \
  --auth-supabase-url "https://YOUR-PROJECT.supabase.co" \
  --auth-supabase-publishable-key "sb_publishable_..." \
  --app-public-url "http://localhost:5173"

npx jskit add bundle auth-base
```
