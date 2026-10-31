# Stack

## Stack packages
- `genesis-stack`

## Components
- `nodejs`
- `jskit`
- `vue`
- `mysql`
- `postgresql`
- `sqlite`
- `shell`

## Environment files

- Nothing.

## Verification

- Verify `application`: `npm` `run` `verify`

## Deployment

- Runtimes: `nodejs`
- Recreate on restore: `node_modules`
- Prepare `Install dependencies`: `npm` `ci`
- Build `Build documentation`: `npm` `run` `docs:build`
- Artifact: `packages/agent-docs/site/.vitepress/dist`
- Deployment owner: `.github/workflows/verify.yml`

## Outputs

### Target `docs`: Documentation site

- Default.
- Mode: `interactive`
- Runtimes: `nodejs`
- Run `Develop`: `npm` `run` `docs:dev` `--` `--host` `0.0.0.0` `--port` `3000`

#### Presentation

- Kind: `web`
- Preferred port: `3000`
- URL path: `/`
- Ready when: `GET` `/` returns `200`

## Resource estimates

### Output `docs`

- Startup typical MiB: `1024`
- Startup high MiB: `1536`
- Running typical MiB: `768`
- Running high MiB: `1536`

### Workspace setup

- Typical MiB: `1024`
- High MiB: `1536`

## UI discovery

### Discovery `vue-pages`: Documentation pages

- Adapter: `jskit`
- Surface: `docs`
- Mode: `filesystem`
- Page root: `packages/agent-docs/site`
- Registration: `packages/agent-docs/site/.vitepress/config.mjs`
- Component root: `packages/agent-docs/site/.vitepress/theme`

## Package discovery

### Discovery `npm`: Direct dependencies of the root and of each workspace package

- Adapter: `npm`
- Manifest: `package.json`
- Manifest: `packages/agent-docs/package.json`
- Manifest: `packages/architecture-inspector/package.json`
- Manifest: `packages/assistant-core/package.json`
- Manifest: `packages/assistant-runtime/package.json`
- Manifest: `packages/assistant-voice/package.json`
- Manifest: `packages/assistant-voice-sherpa/package.json`
- Manifest: `packages/auth-core/package.json`
- Manifest: `packages/auth-provider-local-core/package.json`
- Manifest: `packages/auth-provider-local-db-core/package.json`
- Manifest: `packages/auth-provider-oidc-core/package.json`
- Manifest: `packages/auth-provider-supabase-core/package.json`
- Manifest: `packages/auth-web/package.json`
- Manifest: `packages/connector-google-calendar/package.json`
- Manifest: `packages/connectors-catalog/package.json`
- Manifest: `packages/connectors-core/package.json`
- Manifest: `packages/connectors-web/package.json`
- Manifest: `packages/console-core/package.json`
- Manifest: `packages/console-web/package.json`
- Manifest: `packages/crud-core/package.json`
- Manifest: `packages/database-runtime/package.json`
- Manifest: `packages/database-runtime-mysql/package.json`
- Manifest: `packages/database-runtime-postgres/package.json`
- Manifest: `packages/http-runtime/package.json`
- Manifest: `packages/http-web/package.json`
- Manifest: `packages/json-rest-api-core/package.json`
- Manifest: `packages/kernel/package.json`
- Manifest: `packages/mobile-capacitor/package.json`
- Manifest: `packages/oidc-issuer-core/package.json`
- Manifest: `packages/payments-core/package.json`
- Manifest: `packages/payments-web/package.json`
- Manifest: `packages/realtime/package.json`
- Manifest: `packages/resource-core/package.json`
- Manifest: `packages/resource-crud-core/package.json`
- Manifest: `packages/rewarded-core/package.json`
- Manifest: `packages/rewarded-web/package.json`
- Manifest: `packages/shell-web/package.json`
- Manifest: `packages/storage-runtime/package.json`
- Manifest: `packages/uploads-image-web/package.json`
- Manifest: `packages/uploads-runtime/package.json`
- Manifest: `packages/users-core/package.json`
- Manifest: `packages/users-web/package.json`
- Manifest: `packages/workspaces-core/package.json`
- Manifest: `packages/workspaces-web/package.json`
- Manifest: `tooling/config-eslint/package.json`
- Manifest: `tooling/jskit-catalog/package.json`
- Manifest: `tooling/jskit-release/package.json`
- Package root: `node_modules`

## Workspace setup

- Prepare `Install dependencies` with `nodejs` when `package-lock.json` exists: `npm` `ci`

## Connected development

- Default package type: `npm`
