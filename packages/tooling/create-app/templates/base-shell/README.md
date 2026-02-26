# __APP_TITLE__

Minimal JSKIT starter shell.

## What This Is

This is the smallest practical JSKIT app host:

- tiny Fastify server (`/api/v1/health`)
- tiny Vue client shell
- standardized scripts via `@jskit-ai/app-scripts`
- framework composition seed file: `framework/app.manifest.mjs`

## What This Is Not

This app intentionally does not include:

- db wiring
- auth/workspace modules
- billing/chat/social/ai modules
- app-local framework composition engines

Those are layered in later as framework packs/modules.

## Run

```bash
npm install
npm run dev
npm run server
npm run test
npm run test:client
```

## Progressive Bundles

```bash
npx @jskit-ai/jskit add db --provider mysql --no-install
npx @jskit-ai/jskit add auth-base --no-install
```
