# Changing an App from `none` to `personal` or `workspaces`

This note documents what actually has to happen when an app was created with:

```bash
npx @jskit-ai/create-app exampleapp --tenancy-mode none
```

and you later decide to enable workspaces.

When this note says "workspace-enabled", it means either:

- `config.tenancyMode = "personal"`
- `config.tenancyMode = "workspaces"`

## Short version

Changing an app from `none` to a workspace-enabled mode is possible, but the important step is not "install workspace packages".

The important step is:

1. Change `config.tenancyMode` first.
2. Make sure the app has the required auth provider and database runtime.
3. Apply or reapply the workspace packages.

If you install `workspaces-core` or `workspaces-web` while `config.tenancyMode` is still `none`, the install can succeed, but the workspace scaffold is only partially applied.

## Why this happens

The current codebase separates:

- package installation
- package mutations

`create-app` only writes the tenancy line into `config/public.js`. It does not directly scaffold the workspace surfaces itself.

Relevant code:

- `tooling/create-app/src/server/index.js`
- `packages/workspaces-core/package.descriptor.mjs`
- `packages/workspaces-web/package.descriptor.mjs`

The workspace package descriptors gate important mutations on:

```js
config.tenancyMode in ["personal", "workspaces"]
```

That gate controls the actual workspace surface topology and workspace page scaffold.

Examples from the current descriptors:

- `workspaces-core` only appends the `app` and `admin` surface definitions when tenancy is workspace-enabled.
- `workspaces-web` only writes the workspace pages, wrappers, and placement entries when tenancy is workspace-enabled.

At the same time, some workspace-related config can still be written even when tenancy is `none`, which is why a bad install can leave the app in a partial state instead of fully converting it.

## Required prerequisites

A functional workspace app also needs the users/auth/database stack in place.

In practice, before workspaces are added, the app needs:

- an auth provider package that satisfies `auth.provider`
- a database runtime package that satisfies `runtime.database`

For example:

- `auth-provider-supabase-core`
- `database-runtime-postgres`

Without those prerequisites, the workspace install flow is incomplete.

## Converting an app that currently started from `--tenancy-mode none`

Assume the app currently looks like this:

```bash
npx @jskit-ai/create-app exampleapp --tenancy-mode none
npm install
npx jskit add package shell-web
npm install
```

To convert it into a functional workspace-enabled app:

### 1. Change tenancy mode by hand

Edit `config/public.js` and change:

```js
config.tenancyMode = "none";
```

to either:

```js
config.tenancyMode = "personal";
```

or:

```js
config.tenancyMode = "workspaces";
```

This is the one required hand edit.

### 2. Install missing prerequisites

If the app does not already have them, install:

- an auth provider package
- a database runtime package

Example:

```bash
npx jskit add package auth-provider-supabase-core \
  --auth-supabase-url https://YOUR-PROJECT.supabase.co \
  --auth-supabase-publishable-key sb_publishable_... \
  --app-public-url http://localhost:5173

npx jskit add package database-runtime-postgres \
  --db-name app_db \
  --db-user app_user \
  --db-password app_password
```

If your app uses MySQL, install `database-runtime-mysql` instead.

### 3. Apply the workspace packages

If the workspace packages are not installed yet:

```bash
npx jskit add package workspaces-core
npx jskit add package workspaces-web
npm install
```

Then run migrations against the real database:

```bash
npm run db:migrate
```

## If `workspaces-core` / `workspaces-web` were already installed under `none`

This is the important recovery case.

If those packages were already installed while tenancy was still `none`, changing `config.tenancyMode` is not enough by itself.

You must reapply them:

```bash
npx jskit update package workspaces-core
npx jskit update package workspaces-web
```

Why:

- `jskit add package ...` skips reinstall/reapply when the same package version is already installed
- `jskit update package ...` forces a reapply

Relevant code:

- `tooling/jskit-cli/src/server/commandHandlers/packageCommands/add.js`
- `tooling/jskit-cli/src/server/commandHandlers/packageCommands/update.js`

## What the conversion should generate automatically

Once tenancy is correct and the workspace packages are applied, JSKit should generate the workspace scaffold automatically. The intended outcome includes:

- workspace surface definitions in `config/public.js`
- workspace policy and roles wiring
- workspace pages under `src/pages/w/[workspaceSlug]/...`
- workspace shell wrappers for `app` and `admin`
- workspace placements in `src/placement.js`
- users/workspaces migrations

In the current codebase, this means the correct source scaffold is generated by JSKit once the package mutations are allowed to run.

## What still differs from a fresh workspace-enabled app

If you compare:

- an app created from day one as workspace-enabled
- an app converted from `none`

the JSKit-managed source scaffold can match, but some generated artifacts will still differ.

Typical differences:

- migration filenames, because they include timestamps
- `.jskit/lock.json`, because it records installation time and generated artifact paths
- `package-lock.json`, because npm resolution timing and tree shape can differ

So there are two separate goals:

- functional parity: achievable through the conversion above
- byte-for-byte identity: not guaranteed unless you also normalize those generated artifacts

## What happens to existing `home` CRUDs

Existing CRUDs that already run on `home` are not automatically broken when you enable workspaces.

`home` remains a normal non-workspace surface, so existing `home` CRUD servers and clients can continue to work as they are.

What does **not** happen automatically is conversion from `home` CRUD to workspace-scoped CRUD.

## If you want to move existing CRUD from `home` to `app` or `admin`

This is a real migration. It is not a one-line config flip.

### Server CRUD

Generated CRUD server code bakes in the target surface and whether the route is workspace-scoped.

That affects generated code such as:

- route base path shape
- workspace slug handling
- validators
- action permissions
- role grants
- resolved ownership filter

Relevant code:

- `packages/crud-server-generator/src/server/buildTemplateContext.js`
- `packages/crud-server-generator/templates/src/local-package/server/CrudProvider.js`
- `packages/crud-server-generator/templates/src/local-package/server/registerRoutes.js`
- `packages/crud-server-generator/templates/src/local-package/server/actions.js`

Because of that, the safe path is:

1. regenerate the CRUD server for the target workspace surface
2. port any custom logic from the old `home` version into the new generated baseline

### UI CRUD

CRUD UI is somewhat easier to move because API resolution is surface-aware at runtime.

Relevant code:

- `packages/users-web/src/client/composables/usePaths.js`

But it still is not zero-work:

- page files need to live under the correct workspace surface path
- `src/placement.js` may need updated placement entries
- any explicit lookup relation `surfaceId` values need to be audited

Relevant code:

- `packages/users-web/src/client/composables/crud/crudLookupFieldRuntime.js`

The safe path is still:

1. regenerate the CRUD UI at the target surface
2. port the custom UI work on top

This is especially important if the UI has already been heavily customized.

## Practical recommendation

If there is any realistic chance the app will need workspaces later, start with:

```bash
npx @jskit-ai/create-app exampleapp --tenancy-mode personal
```

Use `--tenancy-mode none` only when you are confident the app should stay non-workspace.

For an app that already exists in `none` mode:

- keep existing `home` features running during the transition
- enable workspace tenancy properly
- add the workspace scaffold
- migrate features from `home` to `app` or `admin` gradually

## Recommended recovery checklist

For an existing app created with `--tenancy-mode none`:

1. Change `config.tenancyMode` to `personal` or `workspaces`.
2. Install missing auth/database prerequisites.
3. If workspaces packages were never installed, `add` them.
4. If workspaces packages were already installed, `update` them to force reapply.
5. Run `npm install`.
6. Run `npm run db:migrate`.
7. Leave existing `home` CRUDs alone unless you intentionally want them to become workspace-scoped.
8. For CRUDs that must move under `app` or `admin`, regenerate and port custom changes.
