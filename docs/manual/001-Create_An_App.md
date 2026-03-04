# 001 - Create An App

## Developers only (ignore for now)

```bash
~/Development/current/jskit-ai/tooling/create-app/templates/base-shell/scripts/verdaccio-reset-and-publish-packages.sh
mkdir -p manual-app
cd manual-app
npx @jskit-ai/create-app manual-app --target .
npm install
npx jskit add package @jskit-ai/auth-provider-supabase-core --no-install
npx jskit add bundle auth-base --no-install
npm install
scripts/link-local-jskit-packages.sh
cp ~/Development/DOTENV_DEV ./.env
```

## Prepare target directory

```bash
mkdir -p manual-app
cd manual-app
```

## Scaffold into current directory

```bash
npx @jskit-ai/create-app manual-app --target .
```

Notes:
- Do **not** run `npm init` before scaffolding; `create-app` writes the app `package.json`.
- `--template` is optional (`base-shell` is the default).
- `--initial-bundles` is optional (`none` is the default).
- If target contains only `.git`, it is allowed.
- If target contains other files, use `--force`.

## Install and run

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

Open:

```text
http://localhost:5173/app
http://localhost:5173/admin
http://localhost:5173/console
```

Expected:
- Pages render from filesystem routing (`src/pages`).
- `GET /api/v1/health` returns `404` until runtime routes are installed via JSKIT modules.


## Overview on what is included

INSTRUCTIONS: Describe what it in the directory, assuming that the person is somewhat familiar with fastapi and Vue.
Explain the file structure, where happens when the server is run, etc. Give an overview of the server directories, and where the client code is.
End the tour at the main provider

## The main Provider

INSTRUCTIONS: jskit comes with a base main module which you can use to expand your software
Brief introduction to provides, and Instructions on how to add a server route introducing the concepts of controllers, service, etc.
Add a route that uses all concepts.

## To be done later

npx jskit add package @jskit-ai/auth-provider-supabase-core --no-install
npx jskit add bundle auth-base --no-install
npm install
