# Console

This chapter adds a separate `console` surface and looks at how JSKIT keeps that operator slice separate from the normal account/user layer.

The important architectural change is simple:

- `users-web` owns account UI
- `console-web` owns console UI
- `console-core` owns the console schema, bootstrap flag, routes, and services behind it

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
npm install
npm run db:migrate
```

If you are already continuing from the previous chapter, you are already in the right place and can skip that setup.

## Installing `console-web`

From inside `exampleapp`, run:

```bash
npx jskit add package console-web
npm install
npm run db:migrate
```

`console-web` brings one important dependency with it:

- `console-core` owns the console schema, owner check, bootstrap flag, and API routes
- `console-web` owns the console surface scaffold, settings shell, and menu placement

So the console is a real vertical slice now. The users packages no longer know about it.

## What the console is for

The console is not a second home page, and it is not the same as account settings.

Its role is much lower-level than that.

- `account` is for the current user's own profile and settings
- `console` is for the people who run the app as a whole

So when you think about the console, think in terms of app runtime and operations, not personal preferences.

This is the surface where you would expect to put things like:

- site-wide bans or other cross-user moderation controls
- server error logging and inspection
- operational diagnostics
- maintenance or repair scripts
- global feature switches
- whole-app settings that affect every user, not just the current one

In other words, the console is the place for configuring and inspecting the runtime of the application as a whole.

That is why the starter console page describes itself as:

- operator tools
- scripts
- diagnostics

It is also why the console surface has stricter access rules than `/account`. `/account` is for any signed-in user. `console` is for trusted operators with low-level control over the running app.

## Running it

Start both processes:

```bash
npm run dev
npm run server
```

Then sign in.

Once you are authenticated, two things matter:

- the app now knows who you are as a persistent JSKIT user
- the console bootstrap logic can determine whether you are the console owner

Open:

```text
http://localhost:5173/console
```

In a fresh app, the console is intentionally simple.

- `/console` is the surface landing page
- `/console/settings` is the first nested shell route under it

That simplicity is useful. It shows the surface boundary clearly before later modules add real console tools.

## Why console access is stricter than account access

This is the most important idea in the chapter.

The account surface only requires authentication. The console surface requires a specific access flag: `console_owner`.

That means the guide now has two different kinds of authenticated routes:

- normal authenticated routes such as `/account`
- privileged authenticated routes such as `/console`

This is a very useful distinction for junior developers to see early, because many real apps need both:

- somewhere for every signed-in user
- somewhere only for the app owner or operators

## The first console owner

In a fresh app, the console owner is not configured by hand in a seed file. Instead, JSKIT assigns the first console owner lazily during authenticated bootstrap.

The rule is simple:

- when the users bootstrap contributor has already identified a signed-in user
- and the later console bootstrap contributor runs for that same request
- and the singleton console settings record has no owner yet
- **that user becomes the initial console owner**

So the first real authenticated user to pass through that path claims the console. After that, the console owner check becomes strict.

This is why the console chapter belongs after the users chapter:

- before persistent users exist, there is nobody to own the console
- once persistent users exist, JSKIT can finally attach console ownership to a real user id

## What `console-web` adds to the app

The console surface is spread across surface config, access policy config, the placement registry, and the persistent `console_settings` table.

### `config/public.js` defines the surface

The console surface definition is small, but very important:

```js
config.surfaceDefinitions.console = {
  id: "console",
  label: "Console",
  pagesRoot: "console",
  enabled: true,
  requiresAuth: true,
  requiresWorkspace: false,
  accessPolicyId: "console_owner",
  origin: ""
};
```

Two details matter most:

- `requiresAuth: true`
- `accessPolicyId: "console_owner"`

So this is not just a named route tree. It is a surface with its own access contract.

### `config/surfaceAccessPolicies.js` defines the rule

The matching access policy is:

```js
surfaceAccessPolicies.console_owner = {
  requireAuth: true,
  requireFlagsAll: ["console_owner"]
};
```

This is the first clear example in the guide of a surface guarded by a named flag rather than only by authentication.

### The starter console routes are app-owned

After the previous chapter, the app now has:

```text
src/pages/console.vue
src/pages/console/index.vue
src/pages/console/settings.vue
src/pages/console/settings/index.vue
```

This follows the same route-owner pattern the guide has already shown on `home` and `settings`.

- `src/pages/console.vue` is the console surface wrapper
- `src/pages/console/index.vue` is the console landing page
- `src/pages/console/settings.vue` is the nested settings shell
- `src/pages/console/settings/index.vue` is the initial developer-owned stub

That last file is intentionally empty, because later modules are expected to add real console settings sections into the `console-settings:primary-menu` outlet.

### `src/placement.js` wires the first console menu entry

The starter placement block is:

```js
addPlacement({
  id: "console.web.menu.settings",
  target: "shell-layout:primary-menu",
  surfaces: ["console"],
  order: 100,
  componentToken: "local.main.ui.menu-link-item",
  props: {
    label: "Settings",
    to: "/console/settings",
    icon: "mdi-cog-outline"
  },
  when: ({ auth }) => Boolean(auth?.authenticated)
});
```

This is why the console drawer immediately has a `Settings` entry.

The important design point is the same as in earlier chapters:

- the shell layout stays generic
- the placement registry decides what appears in that surface

## Under the hood

### `console-core` installs the `console_settings` schema

The console migration creates a singleton console settings table:

```js
await knex.schema.createTable("console_settings", (table) => {
  table.bigInteger("id").primary();
  table.bigInteger("owner_user_id").unsigned().nullable().references("id").inTable("users").onDelete("SET NULL");
  table.timestamp("created_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
  table.timestamp("updated_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
});

await knex("console_settings").insert({
  id: 1,
  created_at: knex.fn.now(),
  updated_at: knex.fn.now()
});
```

That table is the anchor for console ownership.

There is only one console settings record, and it can point at exactly one `owner_user_id`.

### The console service claims the first owner lazily

The core console service is small enough to read in one glance:

```js
async function ensureInitialConsoleMember(userId, options = {}) {
  const normalizedUserId = normalizeRecordId(userId, { fallback: null });
  if (!normalizedUserId) {
    throw new AppError(400, "Invalid console user.");
  }

  return consoleSettingsRepository.ensureOwnerUserId(normalizedUserId, options);
}

async function requireConsoleOwner(context = {}, options = {}) {
  const actorUserId = normalizeRecordId(context?.actor?.id, { fallback: null });
  if (!actorUserId) {
    throw new AppError(401, "Authentication required.");
  }

  const ownerUserId = await ensureInitialConsoleMember(actorUserId, options);
  if (actorUserId !== ownerUserId) {
    throw new AppError(403, "Forbidden.");
  }
}
```

That explains the whole startup story.

- if no console owner exists yet, the first authenticated user can become it
- once an owner exists, everyone else fails the ownership check

So the console is seeded lazily, not through a hard-coded seed user.

### `console-core` adds the console access flag to the bootstrap payload

After the users bootstrap contributor has already built the authenticated session payload, the later `console-core` bootstrap contributor extends it with the console flag:

```js
surfaceAccess: {
  ...surfaceAccess,
  consoleowner: consoleOwner
}
```

This detail is easy to miss, but it matters:

- `users-core` identifies the authenticated user and writes `session.userId`
- `console-core` reads that authenticated user id
- `console-core` seeds or checks the singleton console owner record
- then `console-core` writes `surfaceAccess.consoleowner` into the bootstrap payload

That is how JSKIT can reason about console access at surface level without making the users packages know anything about the console.

So the console chapter is really about a three-part contract:

- a surface definition in public config
- an ownership check on the server
- a persistent owner slot in the database

That is why the console feels like a real app feature already, even before later chapters add CRUDs and richer operator tools into it.

## Summary

This chapter introduced the first privileged operator surface in the guide.

- `console-web` added the `console` surface and its starter UI scaffold
- `console-core` added the console schema, services, bootstrap contributor, and ownership rules
- the app gained a new surface that is stricter than `/account`

That stricter access model is the key idea to keep:

- `/account` is for any signed-in user
- `/console` is only for the console owner

So the app now has both:

- a normal authenticated user area
- a privileged operator area with its own server-side ownership check

The next chapter changes the routing model again by adding workspace-aware surfaces instead of only global ones.
