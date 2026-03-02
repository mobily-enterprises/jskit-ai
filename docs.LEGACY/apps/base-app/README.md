# Base App

Minimal JSKIT starter shell in the monorepo.

## What This Is

This is the smallest practical app host:

- tiny Fastify server (`/api/v1/health`)
- tiny Vue client shell
- standardized scripts via `@jskit-ai/app-scripts`

## What This Is Not

This app intentionally does not include:

- db wiring
- auth/workspace modules
- billing/chat/social/ai modules
- app-local framework composition engines

Those are layered in later as framework packs/modules.

## Run

```bash
npm run -w apps/base-app dev
npm run -w apps/base-app server
npm run -w apps/base-app test
npm run -w apps/base-app test:client
```
