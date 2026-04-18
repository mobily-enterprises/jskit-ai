# Multi-homing

Up to this point, the app has had several surfaces, but none of them were workspace-dependent. `home`, `auth`, `account`, and `console` all live outside any workspace slug.

This chapter changes that. We turn the app into a workspace-aware application and install the packages that add the first real workspace surfaces.

This is the first chapter in the guide that requires one manual config edit before installing packages. That is not accidental. Multi-homing changes the routing model of the app itself, so the app has to declare that new tenancy mode first.

## Recap from previous chapters

To get back to the same starting point as the end of the previous chapter, run:

```bash
SUPABASE_URL=...
SUPABASE_KEY=...
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=exampleapp
DB_USER=exampleapp
DB_PASSWORD=secret

npx @jskit-ai/create-app exampleapp --tenancy-mode none
cd exampleapp
npm install

npx jskit add package shell-web
npx jskit add package auth-provider-supabase-core \
  --auth-supabase-url "$SUPABASE_URL" \
  --auth-supabase-publishable-key "$SUPABASE_KEY" \
  --app-public-url "http://localhost:5173"
npx jskit add bundle auth-base
npx jskit add package database-runtime-mysql \
  --db-host "$DB_HOST" \
  --db-port "$DB_PORT" \
  --db-name "$DB_NAME" \
  --db-user "$DB_USER" \
  --db-password "$DB_PASSWORD"
npx jskit add package users-web
npx jskit add package console-web
npm install
npm run db:migrate
```

If you are already continuing from the previous chapter, you are already in the right place and can skip that setup.

## Enable workspace tenancy first

Before installing the workspace packages, edit `config/public.js` and change:

```js
config.tenancyMode = "none";
```

to:

```js
config.tenancyMode = "workspaces";
```

This chapter uses `workspaces`, not `personal`, because this is the actual multi-workspace mode.

- `personal` is the workspace-enabled mode where each user gets one auto-provisioned personal workspace
- `workspaces` is the mode where multiple workspaces are first-class and use user-selected slugs

For a chapter specifically about multi-homing, `workspaces` is the right one to teach.

<DocsTerminalTip label="Important" title="Change Tenancy Before Installing The Packages">
This is the one part of the flow you should not skip.

The workspace package descriptors gate important file mutations on the app's tenancy mode. If you install `workspaces-core` and `workspaces-web` while `config.tenancyMode` is still `"none"`, the install can only apply part of the scaffold.

So the correct order is:

1. change `config.tenancyMode` to `"workspaces"`
2. add `workspaces-core`
3. run `npm install`
4. add `workspaces-web`
5. run `npm install`
6. run `npm run db:migrate`
</DocsTerminalTip>

## Installing the workspace packages

After changing `config.tenancyMode`, run:

```bash
npx jskit add package workspaces-core
npm install
npx jskit add package workspaces-web
npm install
npm run db:migrate
```

`workspaces-core` adds the server-side workspace runtime and schema migrations. `workspaces-web` adds the workspace-facing client surfaces, shell placements, and app-owned route files.

## What changes now

This chapter is where the app stops being a collection of global surfaces and starts supporting workspace-dependent ones.

### Two new workspace surfaces appear

After the install, the app gains:

- an `app` surface rooted at `/w/[workspaceSlug]`
- an `admin` surface rooted at `/w/[workspaceSlug]/admin`

These are real surfaces, not only pages.

- `app` is the primary in-workspace surface
- `admin` is the privileged workspace administration surface

That is why this chapter feels larger than the previous ones. It is not just adding another route. It is adding a new routing topology.

### The shell and account surface gain workspace-aware controls

The placement registry now grows a workspace selector in the top-left of the shell, a pending-invites cue in the top-right area, and workspace tools in the admin shell. The workspaces package also plugs an `Invites` section into the existing `/account` settings screen through the account-settings extension seam that `users-web` exposes.

That means the shell itself starts adapting to workspace context.

- on any authenticated surface, the shell can now expose a workspace selector
- signed-in users can now see a pending-invites cue without `users-web` owning that workspace feature
- on admin workspace surfaces, the shell can also expose workspace-specific tools and settings

This is the first time the guide shows the shell reacting not just to authentication state, but to workspace state as well.

### The database schema grows real multi-workspace tables

`workspaces-core` adds the schema needed for:

- workspaces
- workspace memberships
- workspace settings
- workspace invites

That is why `npm run db:migrate` is required again in this chapter. The workspace runtime is not only client-side routing. It is persistent tenancy data.

### Existing surfaces do not disappear

This is also important to notice:

- `home` still exists
- `auth` still exists
- `account` still exists
- `console` still exists

The new workspace surfaces are added on top of the existing app, not instead of it.

That is exactly what multi-homing should feel like. The app now has both:

- global surfaces
- workspace-scoped surfaces

## What to look at in the browser

Start both processes again:

```bash
npm run dev
npm run server
```

After you sign in, the app now has the routing structure needed for workspace-aware paths such as:

```text
/w/acme
/w/acme/admin
```

At this stage of the guide, the starter workspace pages are still intentionally simple. That is helpful. It lets you see the new routing and shell topology clearly before later chapters add real modules inside those surfaces.

The most important new visible ideas are:

- a workspace slug now appears in the route
- the shell can expose workspace selection and workspace tools
- workspace-dependent surfaces can show a dedicated unavailable-state card when the requested workspace cannot be resolved

## Under the hood

This chapter changes the app in four main places:

- public config
- surface access policies
- migrations
- workspace surface route files and placements

### `config/public.js` changes in a big way

The first change is the explicit tenancy mode:

```js
config.tenancyMode = "workspaces";
```

Then the app gets two new surface definitions:

```js
config.surfaceDefinitions.app = {
  id: "app",
  label: "App",
  pagesRoot: "w/[workspaceSlug]",
  enabled: true,
  requiresAuth: true,
  requiresWorkspace: true,
  accessPolicyId: "workspace_member",
  origin: ""
};

config.surfaceDefinitions.admin = {
  id: "admin",
  label: "Admin",
  pagesRoot: "w/[workspaceSlug]/admin",
  enabled: true,
  requiresAuth: true,
  requiresWorkspace: true,
  accessPolicyId: "workspace_member",
  origin: ""
};
```

And the app also gains workspace-level feature config:

```js
config.workspaceSwitching = true;
config.workspaceInvitations = {
  enabled: true,
  allowInPersonalMode: true
};
```

Those lines are the public contract that tells both client and server, "this app is workspace-aware now."

### `config/surfaceAccessPolicies.js` gains `workspace_member`

The new workspace surfaces use a workspace membership rule:

```js
surfaceAccessPolicies.workspace_member = {
  requireAuth: true,
  requireWorkspaceMembership: true
};
```

This is the first time the guide shows a surface guarded not just by auth or a simple flag, but by real workspace membership.

That is the core idea of multi-homing in JSKIT:

- the route contains a workspace slug
- the server resolves that workspace
- access depends on whether the current user belongs to it

### The migrations now include workspace schema

After `workspaces-core`, the migration directory grows again with files such as:

```text
migrations/
  2026..._workspaces-core-initial-schema.cjs
  2026..._users-core-workspace-settings-single-name-source.cjs
  2026..._users-core-workspaces-drop-color.cjs
```

These are the tables and schema changes that make workspace tenancy real in the database.

That is why the chapter needs another `npm run db:migrate`. Without those tables, the workspace runtime would have routes and UI, but nowhere to persist workspace membership and settings.

### The route tree gains workspace-dependent pages

The app now gets:

```text
src/pages/w/[workspaceSlug].vue
src/pages/w/[workspaceSlug]/index.vue
src/pages/w/[workspaceSlug]/admin.vue
src/pages/w/[workspaceSlug]/admin/index.vue
src/pages/w/[workspaceSlug]/admin/members/index.vue
src/pages/w/[workspaceSlug]/admin/workspace/settings.vue
src/pages/w/[workspaceSlug]/admin/workspace/settings/index.vue
```

That list shows the first real nested workspace topology.

- `w/[workspaceSlug].vue` is the `app` surface wrapper
- `w/[workspaceSlug]/admin.vue` is the `admin` surface wrapper
- the child pages under them are the first starter pages for those surfaces

So the workspace surface model is not only a config concept. It becomes a real file-based routing tree in `src/pages/`.

### Workspace pages are prepared for missing-workspace states

The starter workspace pages already use a dedicated unavailable-state helper:

```vue
<WorkspaceNotFoundCard
  v-if="workspaceUnavailable"
  :message="workspaceUnavailableMessage"
  surface-label="App"
/>
```

That is worth noticing because it shows that workspace routing is not just string matching on `[workspaceSlug]`. The runtime is expected to decide whether the requested workspace is actually valid and accessible.

So the starter pages already distinguish:

- valid workspace context
- invalid or inaccessible workspace context

### `src/placement.js` becomes workspace-aware

The workspace packages append a new block of placements:

```js
addPlacement({
  id: "workspaces.profile.menu.surface-switch",
  target: "auth-profile-menu:primary-menu",
  surfaces: ["*"],
  order: 100,
  componentToken: "workspaces.web.profile.menu.surface-switch-item",
  when: ({ auth }) => Boolean(auth?.authenticated)
});

addPlacement({
  id: "workspaces.workspace.selector",
  target: "shell-layout:top-left",
  surfaces: ["*"],
  order: 200,
  componentToken: "workspaces.web.workspace.selector",
  props: {
    allowOnNonWorkspaceSurface: true,
    targetSurfaceId: "app"
  },
  when: ({ auth }) => {
    return Boolean(auth?.authenticated);
  }
});

addPlacement({
  id: "workspaces.account.invites.cue",
  target: "shell-layout:top-right",
  surfaces: ["*"],
  order: 850,
  componentToken: "local.main.account.pending-invites.cue",
  when: ({ auth }) => Boolean(auth?.authenticated)
});

addPlacement({
  id: "workspaces.workspace.tools.widget",
  target: "shell-layout:top-right",
  surfaces: ["admin"],
  order: 900,
  componentToken: "workspaces.web.workspace.tools.widget"
});

addPlacement({
  id: "workspaces.workspace.menu.workspace-settings",
  target: "workspace-tools:primary-menu",
  surfaces: ["admin"],
  order: 100,
  componentToken: "workspaces.web.workspace-settings.menu-item"
});

addPlacement({
  id: "workspaces.workspace.menu.members",
  target: "workspace-tools:primary-menu",
  surfaces: ["admin"],
  order: 200,
  componentToken: "workspaces.web.workspace-members.menu-item"
});
```

That one block explains a lot of the new shell behavior.

- the authenticated profile menu can now switch into workspace surfaces
- the top-left area now has a workspace selector
- the top-right area can show a pending-invites cue
- the admin surface gets workspace tools in the top-right area
- the admin workspace settings menu is now another nested placement host with both `Settings` and `Members`

So the placement system from the shell chapter is still doing the same job as before. The app just has a richer routing and tenancy context now.

### The local client provider gets one more app-owned token

`workspaces-web` also appends an app-owned component registration:

```js
registerMainClientComponent("local.main.account.pending-invites.cue", () => AccountPendingInvitesCue);
```

That is the pending-invites cue used in the shell when workspace invitations exist.

This is worth noticing because it follows the same app-owned token pattern the guide has shown before:

- the package installs an app-owned component file
- the app-local provider publishes it under a stable token
- placements can then render it through the shell

### Why this chapter is the real routing pivot

Earlier chapters added features inside a flat top-level app.

This chapter is different. It changes the shape of the app itself.

Before:

- global surfaces only
- no workspace slug in routes
- no workspace membership checks

After:

- global surfaces still exist
- workspace-scoped surfaces now exist too
- the shell can navigate between workspaces
- access to some surfaces now depends on workspace membership

That is why multi-homing deserves its own chapter. It is not just another feature package. It is the moment the app becomes tenancy-aware.

## Summary

This chapter is the real routing and tenancy pivot in the guide.

- the app switched from `tenancyMode = "none"` to `tenancyMode = "workspaces"`
- `workspaces-core` added the persistent schema and server runtime for workspaces
- `workspaces-web` added the first workspace-scoped surfaces, shell controls, and the workspace-owned account invites extension

At the end of this chapter, the app now has both:

- global surfaces such as `home`, `auth`, `account`, and `console`
- workspace-scoped surfaces such as `/w/[workspaceSlug]` and `/w/[workspaceSlug]/admin`

That is the most important mental shift to keep:

- earlier chapters added features inside one global app shell
- this chapter changed the topology of the app itself

From here on, later modules are no longer only adding pages or widgets. They can add features inside either:

- the global surfaces
- the workspace-specific surfaces
