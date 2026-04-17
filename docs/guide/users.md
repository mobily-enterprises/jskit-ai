# Users

At the end of the previous chapter, the app had a real database runtime, but it still did not have JSKIT's own persistent users layer. Authentication worked, but the app-side profile mirror was still only the temporary fallback from the auth chapter.

This chapter is where that changes. We install `users-web`, run the new migrations, and let JSKIT start treating authenticated people as persistent app users rather than only as Supabase identities.

`users-web` sounds like a UI package, but it is actually the point where several layers arrive together:

- the persistent users/account data model from `users-core`
- the account surface and account settings UI
- the switch from standalone auth profile sync to users-backed auth profile sync

## Recap from previous chapters

To get back to the same starting point as the end of the previous chapter, run:

```bash
SUPABASE_URL=...
SUPABASE_KEY=...
DB_HOST=localhost
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
npm install
```

If you are already continuing from the previous chapter, you are already in the right place and can skip that setup.

## Installing `users-web`

From inside `exampleapp`, run:

```bash
npx jskit add package users-web
npm install
npm run db:migrate
```

The first command adds `users-web`, but the important part is what arrives with it through its dependency chain.

- `users-web` adds the account-facing UI and client runtime pieces
- `users-core` arrives as a dependency and adds the persistent users/account server layer and schema migrations

`npm install` downloads those new runtime packages and their dependencies. `npm run db:migrate` is the crucial step that makes the new tables real in MySQL.

<DocsTerminalTip label="Important" title="Run The Migrations Before Testing Login">
This is the first chapter where the migration step is not just "nice to have."

`users-core` writes:

- `AUTH_PROFILE_MODE=users` into `.env`
- real users/account schema migrations into `migrations/`

That means the app is now expected to use the persistent users-backed profile sync service. If you skip `npm run db:migrate`, the code and routes are installed, but the required tables are still missing.

So the correct flow is:

1. add `users-web`
2. run `npm install`
3. run `npm run db:migrate`
4. only then start the app and sign in
</DocsTerminalTip>

## What changes now

This chapter is the real transition from "authentication exists" to "the app knows about users."

### Authentication becomes users-backed

In the database chapter, JSKIT still used the standalone in-memory profile mirror. After installing `users-web`, that changes. JSKIT now expects to synchronize authenticated users into real JSKIT tables.

That is the biggest architectural change in this chapter.

- Supabase still owns the real auth identity and session
- JSKIT now also owns a persistent users/account data model in MySQL

So after this chapter, a signed-in user is no longer only "someone Supabase knows about." They are also a persistent JSKIT-side user with settings and profile state in the app database.

### The app gets an authenticated account surface

The app now has a new authenticated surface at `/account`.

This is where the starter account settings UI lives. It already has real sections for:

- profile
- preferences
- notifications

The app can also show an `Invites` section later, but that only appears when the runtime says invites are actually available for the current tenancy/setup.

The important point is that this is no longer just a placeholder route. It is the first app-owned screen that assumes there is a real persistent user model behind it.

### The shell changes for signed-in users

Once a user is signed in, the shell becomes noticeably richer.

- the profile menu gets a `Settings` entry that leads to `/account`
- the home surface gets a small users tools widget in the top-right area
- the auth bootstrap payload now includes persistent user settings instead of only the fallback mirror data

So this chapter is also the first one where logging in changes more than just "guest vs signed in." It now changes what persistent user-facing surfaces the app can expose.

## What to look at in the browser

Start both processes again:

```bash
npm run dev
npm run server
```

Then sign in through `http://localhost:5173/auth/login`.

After a successful sign-in, you should notice three concrete differences compared with the previous chapter:

- the profile menu now contains `Settings`
- `/account` now exists and is authenticated

This is the first chapter where the app starts to feel like it has a real user model behind it.

## Under the hood

The most interesting files now are spread across config, migrations, routing, and the app-owned account UI.

### `.env` flips auth into users mode

The most important new line in `.env` is:

```dotenv
AUTH_PROFILE_MODE=users
```

That one line explains the deepest change in the chapter.

Before this chapter, auth used the standalone fallback profile sync service. After this chapter, auth is told to use the persistent users-backed profile sync flow instead.

That only works because `users-core` also installs the required repositories, services, and tables.

### `migrations/` stops being mostly empty

After `users-web`, the app gets real schema files such as:

```text
migrations/
  2026..._users-core-generic-initial-schema.cjs
  2026..._users-core-profile-username-schema.cjs
```

These files are the first real database schema in the guide.

The important initial migration creates:

- `users`
- `user_settings`

That is why this chapter needs `npm run db:migrate` in a much more serious way than the previous one did.

### `config/public.js` gains one new authenticated surface

After the install, `config/public.js` grows one important surface definition:

```js
config.surfaceDefinitions.account = {
  id: "account",
  label: "Account",
  pagesRoot: "account",
  enabled: true,
  requiresAuth: true,
  requiresWorkspace: false,
  origin: ""
};
```

This chapter keeps the split simple:

- `account` is the normal authenticated user area
- operator surfaces such as `console` are introduced later, by packages that actually own them

### `src/placement.js` grows account entries

The placement registry also becomes more interesting:

```js
addPlacement({
  id: "users.profile.menu.settings",
  target: "auth-profile-menu:primary-menu",
  surfaces: ["*"],
  order: 500,
  componentToken: "auth.web.profile.menu.link-item",
  props: {
    label: "Settings",
    to: "/account"
  },
  when: ({ auth }) => Boolean(auth?.authenticated)
});
```

This chapter is the first one where one package install adds meaningful authenticated shell entries and a real account surface.

### `src/pages/account/index.vue` is a real authenticated route

The account route itself is very small:

```vue
<route lang="json">
{
  "meta": {
    "guard": {
      "policy": "authenticated"
    }
  }
}
</route>

<template>
  <AccountSettingsClientElement />
</template>
```

That is a very JSKIT-style file.

- the route policy is app-owned
- the page wrapper is app-owned
- the heavy UI is delegated to a reusable client element

So the route is simple, but it is already a real authenticated account screen rather than a placeholder card.

### The account screen itself is scaffolded app-owned UI

The account page is backed by:

```text
src/components/account/settings/
  AccountSettingsClientElement.vue
  AccountSettingsProfileSection.vue
  AccountSettingsPreferencesSection.vue
  AccountSettingsNotificationsSection.vue
  AccountSettingsInvitesSection.vue
```

The top-level `AccountSettingsClientElement.vue` uses `useAccountSettingsRuntime()` from `users-web` and wires those sections into a tabbed settings experience.

That is worth noticing because the guide has now reached a new level of scaffolding:

- earlier chapters mostly introduced shells and routes
- this chapter introduces real app-owned feature UI that is already split into reusable sections

### Why auth now behaves differently

In the previous chapter, auth still defaulted to the standalone profile sync fallback. The core logic in `AuthSupabaseServiceProvider` looks like this:

```js
const authProfileMode = resolveAuthProfileMode(env);
let userProfileSyncService = fallbackStandaloneProfileSyncService;

if (authProfileMode === AUTH_PROFILE_MODE_USERS) {
  if (!scope.has("users.profile.sync.service")) {
    throw new Error(
      "AuthSupabaseServiceProvider requires users.profile.sync.service when AUTH_PROFILE_MODE=users."
    );
  }
  userProfileSyncService = scope.make("users.profile.sync.service");
}
```

The important part is no longer hypothetical.

After `users-web`:

- `.env` sets `AUTH_PROFILE_MODE=users`
- `users-core` supplies the users-backed sync service
- the migrations supply the required tables

So auth now has everything it needs to stop using the fallback mirror and start using the persistent users-backed one.

That is the true point of this chapter. The app is no longer just authenticated. It now has a real users layer.
