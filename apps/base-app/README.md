# Base App

Minimal baseline app in the monorepo.

## Core package baseline

This app demonstrates the smallest practical JSKIT-aligned baseline:

- `@jskit-ai/app-scripts` for standardized task running
- `fastify` for server runtime
- `vue` + `vite` for client runtime

Everything else is optional and can be layered by feature/module.

## Run

```bash
npm run -w apps/base-app dev
npm run -w apps/base-app server
npm run -w apps/base-app test
npm run -w apps/base-app test:client
```
