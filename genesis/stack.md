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

### Discovery `npm`: Direct dependencies

- Adapter: `npm`
- Manifest: `package.json`
- Package root: `node_modules`

## Workspace setup

- Prepare `Install dependencies` with `nodejs` when `package-lock.json` exists: `npm` `ci`

## Connected development

- Default package type: `npm`
