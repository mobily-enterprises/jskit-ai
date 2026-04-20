# Authentication

At the end of the previous chapter, the app had a real shell, but it still did not know how to sign users in. In this chapter, we connect the app to Supabase Auth, add the stock JSKIT login and sign-out routes, and inspect the files that make authentication visible in the shell.

This chapter still does **not** add the database-backed users layer. That is intentional. It lets us see the authentication pieces clearly before account pages, profile storage, and workspace membership are added later.

To get back to the same starting point as the end of the previous chapter, run:

```bash
npx @jskit-ai/create-app exampleapp --tenancy-mode none
cd exampleapp
npm install

npx jskit add package shell-web
npm install
```

If you are already continuing from the previous chapter, you are already in the right place and can skip that setup.

<DocsTerminalTip label="Supabase" title="Create The Project First">
Before installing the auth packages, create a Supabase project and collect the three values JSKIT needs.

1. In the Supabase dashboard, create a new project in your organization and wait for it to finish provisioning.
2. Open `Project Settings -> API`. Copy:
   - the **Project URL**
   - the **publishable** key
3. Open `Authentication -> URL Configuration`.
4. Set **Site URL** to:

```text
http://localhost:5173
```

5. Add this local redirect URL:

```text
http://localhost:5173/auth/login
```

JSKIT uses the project URL as `AUTH_SUPABASE_URL`, the publishable key as `AUTH_SUPABASE_PUBLISHABLE_KEY`, and the browser address as `APP_PUBLIC_URL`.

Use the **publishable** key here, not the secret key and not a service-role key. If you later run the app on a different host or port, update both Supabase's URL settings and `APP_PUBLIC_URL` to match the real browser URL exactly.

If you are guiding someone interactively, ask plainly for these exact values:

- `AUTH_SUPABASE_URL`
- `AUTH_SUPABASE_PUBLISHABLE_KEY`
- whether `APP_PUBLIC_URL` should stay `http://localhost:5173`

Do not hide behind vague language like "send the auth credentials later." In this local guide flow, those are routine setup values for the Supabase auth install step.
</DocsTerminalTip>

## Installing the auth layer

From inside `exampleapp`, run:

```bash
npx jskit add package auth-provider-supabase-core \
  --auth-supabase-url "https://YOUR-PROJECT.supabase.co" \
  --auth-supabase-publishable-key "sb_publishable_..." \
  --app-public-url "http://localhost:5173"

npx jskit add bundle auth-base
npm install
```

The first command is the provider step. It tells JSKIT which authentication backend to use and writes the project-specific values into the app.

The second command adds the web auth layer. `auth-base` is a small bundle, not a black box: in practice it adds `auth-core` and `auth-web`, which together provide the auth routes, the auth surface, and the stock login and sign-out screens.

The final `npm install` matters for the same reason it did in the shell chapter: `jskit add` rewrites the scaffold and updates `package.json`, but `npm install` is what actually downloads the newly referenced runtime packages.

## Running it

Authentication needs both the browser-facing dev server and the backend runtime, so start both:

```bash
npm run dev
npm run server
```

Then open `http://localhost:5173/auth/login` in the browser.

<figure class="docs-browser-shot">
  <div class="docs-browser-shot__bar">
    <div class="docs-browser-shot__dots" aria-hidden="true">
      <span></span>
      <span></span>
      <span></span>
    </div>
    <div class="docs-browser-shot__address">http://localhost:5173/auth/login</div>
  </div>
  <img
    src="/images/guide/authentication/authentication-login.png"
    alt="Example app login page after installing JSKIT authentication with Supabase"
  />
</figure>

The login page is now real, and it already contains several different auth modes behind the same card.

- **Sign in** is the normal email-and-password flow.
- **Register** creates a new Supabase auth user.
- **Forgot password?** requests a password reset email.
- **Use one-time code** switches to an email OTP login flow.
- **Remember this account on this device** stores a small local hint in browser storage so the next visit can greet the last-used account and let the user keep that email preselected.

If you go back to `http://localhost:5173/home`, the shell also has a small auth widget in the top-right corner. When you are signed out it shows a guest state and a menu entry that leads to `/auth/login`. After you sign in, the same placement changes to a sign-out menu.

## Reading the screen carefully

The login card is not a single form. It is a small state machine that switches between several modes.

### Normal sign-in mode

This is the first screen you see.

- The `Email` field is validated as an email address.
- The `Password` field is validated with the password rules from the shared auth command schema.
- The eye icon only changes whether the password is visible in the browser.
- The main `Sign in` button posts to `POST /api/login`.
- If sign-in succeeds, JSKIT refreshes the current session and redirects back to the requested return path.

The small links under the password field are not decoration.

- `Forgot password?` switches the card into password-reset-request mode.
- `Use one-time code` switches the card into OTP mode.

### Register mode

When the user presses `Register`, the form changes in three important ways.

- The title changes from `Welcome` to `Create your account`.
- A `Confirm password` field appears.
- The main submit button changes from `Sign in` to `Register`.

Pressing `Register` sends a sign-up request to Supabase through `POST /api/register`. JSKIT also sends a starter `display_name` value derived from the email prefix, so a user registering as `alice@example.com` starts with a display name like `alice`.

What happens next depends on Supabase's email-confirmation settings.

- If email confirmation is required, Supabase creates the user immediately but does not return a live session. The card then switches to a dedicated confirmation state.
- If email confirmation is not required, the user is registered and signed in immediately.

### Email-confirmation state

If Supabase requires confirmation, the screen changes again.

- The mode-switch buttons disappear.
- The card shows a confirmation message instead of the email/password fields.
- `Go to main screen` returns to the app.
- `Resend confirmation email` calls `POST /api/register/confirmation/resend`.
- `Back to sign in` returns to the normal login mode.

This matters because a junior developer might otherwise assume registration failed. In reality, the user usually already exists in Supabase at this point; they just do not have an active session yet.

### One-time-code mode

`Use one-time code` changes the form again.

- The password field disappears.
- A `One-time code` field appears.
- A secondary button called `Send one-time code` appears.
- The main button changes to `Verify code`.

Those two buttons do different jobs.

- `Send one-time code` requests the email through `POST /api/login/otp/request`.
- `Verify code` submits the code through `POST /api/login/otp/verify`.

JSKIT asks Supabase to send OTP login emails only for existing users. In other words, this flow is for signing in, not for silently creating a new account.

### Password-reset-request mode

`Forgot password?` does not immediately let the user type a new password. It switches to a reset-request mode.

- The password field disappears.
- The main button changes to `Send reset instructions`.
- Submitting this screen calls `POST /api/password/forgot`.

That endpoint asks Supabase to send a password reset email. In this chapter's scaffold, this mode is only the **request** step.

The backend already supports the later recovery endpoints too, but the chapter's simple app does **not** yet scaffold a dedicated app-owned `reset-password` page. So at this stage, the guide should be read as: the screen can request recovery emails now, while the full browser-side password-reset completion UI is still something you would add explicitly in the app.

### Remembered account behavior

The checkbox `Remember this account on this device` is also worth understanding.

If it stays checked and the user successfully signs in, registers, or verifies an OTP code, JSKIT stores a small browser-local hint with:

- the normalized email address
- a masked version of the email
- a display name
- a `lastUsedAt` timestamp

On the next visit, the card can show a `Welcome back, ...` panel and a `Use another account` button. This is only a browser convenience feature. It is not a second authentication factor, and it is not a server-side session store.

### OAuth buttons

The screen is also ready to show OAuth provider buttons, but only if providers are configured.

Right now the chapter's `config.server.js` keeps this empty:

```js
config.auth = {
  oauth: {
    providers: [],
    defaultProvider: ""
  }
};
```

That is why the login card in this chapter does not show buttons like `Continue with Google`.

To turn on Google later, there are two separate setup steps.

First, configure Google and Supabase:

1. In Google Auth Platform, create a **Web application** OAuth client.
2. Add your browser URLs as **Authorized JavaScript origins**.
3. In Supabase, open the Google provider settings and copy the provider callback URL shown there.
4. Add that Supabase callback URL as an **Authorized redirect URI** on the Google OAuth client.
5. Back in Supabase, paste the Google **Client ID** and **Client Secret** into the Google provider settings and enable the provider.
6. Make sure Supabase's **Site URL** and **Redirect URLs** still match the real browser URL your app uses.

Then tell JSKIT to expose the provider in the login UI:

```js
config.auth = {
  oauth: {
    providers: ["google"],
    defaultProvider: "google"
  }
};
```

`providers` controls which OAuth buttons the stock login screen is allowed to render. `defaultProvider` tells JSKIT which provider to prefer when it needs a default choice. If the provider is configured in Supabase but missing from this list, the button still does not appear in the JSKIT login screen.

<DocsTerminalTip label="Important" title="What Works Without A Database">
Authentication is already real in this chapter because Supabase is still the source of truth for the important auth data:

- the real auth user record
- the password hash and password-reset state
- the OTP and OAuth flows
- the access and refresh tokens that JSKIT writes into cookies

What is missing is JSKIT's own database-backed users layer. In no-database mode, the auth provider switches to **standalone in-memory fallbacks** for the app-side data it normally mirrors into JSKIT tables.

Concretely, that means:

- JSKIT still creates a local profile mirror for each authenticated Supabase user.
- But that mirror lives only in the Node process, not in a database table.
- That temporary mirror stores only a small app-side profile shape:
  - `id`
  - `authProvider`
  - `authProviderUserSid`
  - `email`
  - `displayName`
- JSKIT also keeps a tiny in-memory user-settings record for auth-related flags such as:
  - `passwordSignInEnabled`
  - `passwordSetupRequired`

So the behavior is:

- register a user -> the real user is created in Supabase
- sign in -> Supabase still verifies credentials and returns the real session
- JSKIT then mirrors just enough profile data into memory so the app can work
- restart the local server -> that JSKIT-side mirror and those fallback settings are cleared

The browser session is a different thing. In the normal case, a server restart does **not** log the browser out. The browser still has the auth cookies, so on the next request JSKIT can read those cookies, validate or refresh the Supabase session, and rebuild the temporary mirror.

That last point is the important difference. A restart does **not** delete the Supabase user. It does **not** erase the real password. It does **not** erase the real auth session in Supabase itself. What it clears is only the app's temporary in-memory mirror. On the next authenticated request, JSKIT rebuilds that mirror from the Supabase user or token claims.

So without a database, you still get:

- real login
- real logout
- real registration
- real password reset requests
- real OTP and OAuth flows
- real session cookies

But you do **not** get:

- persistent JSKIT-side user rows
- persistent JSKIT-side user settings
- account/profile persistence beyond what Supabase itself stores
- workspace membership, user preferences, or the later users/workspaces data model

Later, when the guide installs `users-web`, auth stops using the standalone fallback and starts resolving `users.profile.sync.service` from `users-core` instead.

That service exposes three main functions:

- `findByIdentity(...)` to look up the JSKIT-side user for an auth identity
- `upsertByIdentity(...)` to create or update the JSKIT-side user record directly
- `syncIdentityProfile(...)` to run the normal auth-driven synchronization flow

`syncIdentityProfile(...)` is the one auth actually relies on. It is the method that synchronizes the JSKIT-side user record, ensures the related settings row exists through `ensureForUserId(...)`, and then runs any registered post-sync lifecycle contributors.

So this chapter gives you real authentication, but only a temporary app-side user mirror. The full persistent JSKIT user model comes later with the database and users layers.
</DocsTerminalTip>

## Using auth in your own app

The most important thing this chapter gives you is not just a login page. It gives you three real app-building tools:

- a route-level auth guard
- auth-aware placement predicates
- a client-side auth composable you can read in your own components

Those are different tools, and they do different jobs.

- A route guard protects a URL.
- A placement predicate controls whether a menu entry or widget is visible.
- The auth composable lets your component react to the current session state.

That separation matters. Protecting a route does **not** automatically hide a menu entry, and hiding a menu entry does **not** protect a route.

### Start with a normal public page

Generate a simple page under the public `home` surface:

```bash
npx jskit generate ui-generator page home/reports/index.vue --name "Reports"
```

At this point the page is still public, because `home` is a public surface. JSKIT creates:

- `src/pages/home/reports/index.vue`
- a new menu placement in `src/placement.js`

The placement entry is just a normal shell link:

```js
addPlacement({
  id: "ui-generator.page.home.reports.link",
  target: "shell-layout:primary-menu",
  surfaces: ["home"],
  order: 155,
  componentToken: "local.main.ui.surface-aware-menu-link-item",
  props: {
    label: "Reports",
    surface: "home",
    scopedSuffix: "/reports",
    unscopedSuffix: "/reports"
  }
});
```

And the page file itself is a normal page scaffold:

```vue
<template>
  <section class="pa-4">
    <h1 class="text-h5 mb-2">Reports</h1>
    <p class="text-body-2 text-medium-emphasis">Replace this scaffold with your page implementation.</p>
  </section>
</template>
```

So immediately after generation:

- the `Reports` menu entry is visible to everyone
- `/home/reports` is reachable by everyone

### Gate the page behind login

To make the route require login, add a route guard block to `src/pages/home/reports/index.vue`:

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
  <section class="pa-4">
    <h1 class="text-h5 mb-2">Reports</h1>
    <p class="text-body-2 text-medium-emphasis">Replace this scaffold with your page implementation.</p>
  </section>
</template>
```

That one change protects the route itself. If a signed-out user tries to visit `/home/reports`, the auth guard runtime redirects them to the login route instead of letting the page render.

The redirect also keeps the requested target. In practice the browser ends up on a login URL shaped like this:

```text
/auth/login?returnTo=%2Fhome%2Freports
```

So after login, JSKIT can send the user back to the page they originally asked for.

### Hide the menu entry when signed out

The route is now protected, but the drawer link is still visible. That is expected. Route protection and shell visibility are separate concerns.

To hide the `Reports` menu entry until the user is logged in, update the placement entry in `src/placement.js`:

```js
addPlacement({
  id: "ui-generator.page.home.reports.link",
  target: "shell-layout:primary-menu",
  surfaces: ["home"],
  order: 155,
  componentToken: "local.main.ui.surface-aware-menu-link-item",
  props: {
    label: "Reports",
    surface: "home",
    scopedSuffix: "/reports",
    unscopedSuffix: "/reports"
  },
  // Added: only show this menu entry when the current auth context is authenticated.
  when: ({ auth }) => Boolean(auth?.authenticated)
});
```

The only new part is the `when(...)` line. That predicate is evaluated by the shell placement runtime using the auth context that `auth-web` injects from `/api/session`.

So the behavior now becomes:

- signed out:
  - the `Reports` drawer entry disappears
  - visiting `/home/reports` manually still redirects to `/auth/login`
- signed in:
  - the `Reports` drawer entry appears
  - `/home/reports` renders normally

This is the most important pattern to understand: use the guard to protect the route, and use the placement `when(...)` function to control whether the shell exposes a link to it.

### Read auth state in your own page code

Sometimes you do not want to redirect or hide a menu entry. You just want the page to react differently when a user is logged in.

For that, use `useAuthStore()` from `auth-web`. By this point in the guide the scaffold already has Pinia installed from day 0, and `shell-web` has already shown the same store-facing pattern for shell UI state. `auth-web` adds the auth version of that pattern: a Pinia store facade over the underlying auth runtime, so normal Vue code can read the session state without manually wiring subscriptions.

Here is a small example that changes `src/pages/home/index.vue` so it shows a success message when the session is authenticated:

```vue
<script setup>
import { useAuthStore } from "@jskit-ai/auth-web/client";

const auth = useAuthStore();
</script>

<template>
  <section class="pa-4">
    <v-alert v-if="auth.authenticated" type="success" variant="tonal" class="mb-4">
      You are logged in!
    </v-alert>

    <h1 class="text-h5 mb-2">Home</h1>
    <p class="text-body-2 text-medium-emphasis">Replace this scaffold with your page implementation.</p>
  </section>
</template>
```

The important thing about that snippet is how little it needs to know. `auth.authenticated` is already reactive through Pinia, so the banner updates automatically when the session changes.

`useAuthStore()` also gives you the rest of the surfaced auth state and the lower-level runtime methods when you need them:

- `authState`
- `authenticated`
- `username`
- `oauthProviders`
- `oauthDefaultProvider`
- `initialize()`
- `refresh()`
- `getState()`
- `subscribe()`
- `runtime`

If you need one of those methods, keep the whole auth object instead of only destructuring a single ref:

```vue
<script setup>
import { useAuthStore } from "@jskit-ai/auth-web/client";

const auth = useAuthStore();

async function refreshSession() {
  await auth.refresh();
  console.log(auth.getState());
}
</script>
```

So this is not just useful for a demo banner. It is the same mechanism you would use for:

- guest vs authenticated copy
- showing a call-to-action only for signed-out users
- enabling a tool panel only for authenticated users
- rendering a user-specific welcome message

### The three auth tools, side by side

By this point the surfaced auth API should be clearer:

- route file meta:
  - use `"policy": "authenticated"` when the page itself must be protected
- placement entry:
  - use `when: ({ auth }) => Boolean(auth?.authenticated)` when shell UI should only appear for signed-in users
- component code:
  - use `useAuthStore()` when the page needs to react to auth state directly

That is the real development payoff of this chapter. The login system is not just a screen. It gives the app a reusable auth state model that routing, shell placements, and component code can all use.

At this point the guide has shown three distinct layers of client state:

- the scaffold installs Pinia but does not expose any package stores yet
- `shell-web` adds shell-facing stores such as `useShellLayoutStore()`
- `auth-web` adds `useAuthStore()` for authentication state

That progression is intentional. Packages keep their operational runtimes internally, but the app-facing shared state they surface to Vue code is now store-based.

## What `auth-base` adds to the app

The interesting part of this chapter is that authentication appears in several different layers at once: environment config, public routing config, shell placements, and app-owned view wrappers.

The first new place to inspect is `package.json`:

```json
{
  "scripts": {
    "server:auth": "SERVER_SURFACE=auth node ./bin/server.js",
    "dev:auth": "VITE_SURFACE=auth vite",
    "build:auth": "VITE_SURFACE=auth vite build"
  },
  "dependencies": {
    "@jskit-ai/auth-core": "0.x",
    "@jskit-ai/auth-provider-supabase-core": "0.x",
    "@jskit-ai/auth-web": "0.x"
  }
}
```

Three things are worth noticing immediately.

- `auth-provider-supabase-core` is the provider-specific runtime.
- `auth-web` is the part that adds the web routes and the default auth UI.
- there is now an `auth` surface-specific dev/build script family, just as `home` already had.

The provider command also writes a new `.env` file:

```dotenv
AUTH_PROVIDER=supabase
AUTH_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
AUTH_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
APP_PUBLIC_URL=http://localhost:5173
```

This is the bridge between the scaffold and your real Supabase project. `APP_PUBLIC_URL` matters because auth emails and callback flows need to know which browser URL they should return to.

Public routing config changes too. `config/public.js` now has a second surface:

```js
config.surfaceDefinitions.auth = {
  id: "auth",
  label: "Auth",
  pagesRoot: "auth",
  enabled: true,
  requiresAuth: false,
  requiresWorkspace: false,
  origin: ""
};
```

That `requiresAuth: false` line is important. The auth surface must stay public, otherwise users would need to be logged in before they could reach the login page.

`config/server.js` also gets an auth stub:

```js
config.auth = {
  oauth: {
    providers: [],
    defaultProvider: ""
  }
};
```

That small block explains a lot of the default login screen. The stock UI is ready for OAuth providers such as Google, but right now the provider list is empty, so the page only shows the email/password and one-time-code flows. Later, if you enable a provider in Supabase and list it here, the same login screen can expose that button too.

The auth routes themselves are app-owned wrappers around the module-supplied default views. `src/pages/auth/login.vue` looks like this:

```vue
<route lang="json">
{
  "meta": {
    "guard": {
      "policy": "public"
    }
  }
}
</route>

<script setup>
import DefaultLoginView from "@jskit-ai/auth-web/client/views/DefaultLoginView";
</script>

<template>
  <DefaultLoginView />
</template>
```

There are two important ideas in that small file.

- The route is explicitly public.
- The app owns the page wrapper even though the actual stock login form comes from the installed module.

The `meta.guard` block is ordinary route metadata, not a special auth-only API. The file-based router plugin turns `<route lang="json">` into a normal Vue Router `meta` object first, and then JSKIT reads `meta.guard.policy` during navigation. That same mechanism is used elsewhere in the app too.

That pattern gives you a clean customization seam later. The module supplies a working default, but the app still owns the route file and can replace or wrap the view if needed.

Authentication also becomes visible in the shell through `src/placement.js`:

```js
addPlacement({
  id: "auth.profile.widget",
  target: "shell-layout:top-right",
  surfaces: ["*"],
  order: 1000,
  componentToken: "auth.web.profile.widget"
});

addPlacement({
  id: "auth.profile.menu.sign-in",
  target: "auth-profile-menu:primary-menu",
  surfaces: ["*"],
  order: 200,
  componentToken: "auth.web.profile.menu.link-item",
  props: {
    label: "Sign in",
    to: "/auth/login"
  },
  when: ({ auth }) => !Boolean(auth?.authenticated)
});

addPlacement({
  id: "auth.profile.menu.sign-out",
  target: "auth-profile-menu:primary-menu",
  surfaces: ["*"],
  order: 1000,
  componentToken: "auth.web.profile.menu.link-item",
  props: {
    label: "Sign out",
    to: "/auth/signout"
  },
  when: ({ auth }) => Boolean(auth?.authenticated)
});
```

This is the shell placement system from the previous chapter doing real work again. `auth-web` does not hard-code a permanent top-right button into `ShellLayout.vue`. Instead, it contributes a widget and two menu entries into named outlets, and those entries react to the current auth state.

So the auth story in this chapter is spread across clear responsibilities:

- `.env` tells the provider runtime which Supabase project to talk to
- `config/public.js` declares an `auth` surface
- `config/server.js` exposes app-owned OAuth visibility settings
- `src/pages/auth/*` gives the app real public auth routes
- `src/placement.js` makes auth visible in the shell

That is a very JSKIT-style pattern. The installed package brings the runtime behavior, but the app still owns the important seams where routing and UI get attached.

## Under the hood

### The runtime behind `useAuthStore()`

`useAuthStore()` is the app-facing Pinia layer, but it is not inventing a second auth system. It is a store facade over the lower-level auth guard runtime that `auth-web` boots on startup.

That lower-level runtime already has a small, concrete contract:

- `initialize()`
- `refresh()`
- `getState()`
- `subscribe()`

`auth-web` initializes that runtime once, binds it into the Pinia auth store, and then exposes `useAuthStore()` as the normal component-facing API. That is why the main example earlier could stay so small.

If you strip the composable away and write the same `You are logged in!` example directly against the runtime, it looks like this:

```vue
<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useAuthGuardRuntime } from "@jskit-ai/auth-web/client";

const authGuardRuntime = useAuthGuardRuntime({
  required: true
});
const authState = ref(authGuardRuntime.getState());
let unsubscribe = null;

const isAuthenticated = computed(() => authState.value?.authenticated === true);

onMounted(() => {
  unsubscribe = authGuardRuntime.subscribe((nextState) => {
    authState.value = nextState;
  });
});

onBeforeUnmount(() => {
  if (typeof unsubscribe === "function") {
    unsubscribe();
  }
});
</script>

<template>
  <section class="pa-4">
    <v-alert v-if="isAuthenticated" type="success" variant="tonal" class="mb-4">
      You are logged in!
    </v-alert>

    <h1 class="text-h5 mb-2">Home</h1>
    <p class="text-body-2 text-medium-emphasis">Replace this scaffold with your page implementation.</p>
  </section>
</template>
```

That code works, and it shows exactly what `useAuthStore()` is wrapping:

- `getState()` gives the first auth snapshot immediately
- `subscribe(...)` keeps that snapshot updated later
- the component turns that imperative runtime into normal Vue refs and computeds

For ordinary Vue component code there is usually no advantage to writing it this way. `useAuthStore()` already gives you the same surfaced information plus the same runtime methods when you need them. The direct runtime version is mainly worth knowing so you understand the lower-level contract that `auth-web` itself is building on.

### Who actually talks to whom

The most important thing to understand is that the browser usually talks to **your app**, and your app talks to **Supabase**.

For the normal email-and-password flow, the browser does **not** call Supabase directly. It posts to the app's own API routes such as `/api/login`. The JSKIT server then calls Supabase, receives the Supabase session, and turns that into HTTP-only cookies.

That means there are really three actors in play:

- the browser, which renders the login screen and submits forms
- the JSKIT app server, which owns `/api/login`, `/api/oauth/complete`, `/api/session`, and the cookie-writing step
- Supabase, which owns the real authentication backend, password verification, OAuth exchange, and auth user records

So the mental model should be:

```text
browser -> JSKIT app -> Supabase
browser <- JSKIT app <- Supabase
```

For OAuth there is one extra bounce: the browser is redirected out to Supabase and then back again. But even there, the app still owns the start and completion steps.

### Password login: the full round trip

The simplest login flow is the normal `Email + Password` form.

On the client side, `DefaultLoginView` eventually calls `useLoginViewActions.submitAuth()`. In sign-in mode that becomes a `POST` to:

```text
/api/login
```

with a body shaped roughly like this:

```json
{
  "email": "alice@example.com",
  "password": "correct horse battery staple"
}
```

From there, the server-side flow is:

1. `POST /api/login` hits the route registered by `auth-web`.
2. `AuthController.login()` receives the request.
3. `AuthWebService.login()` executes the internal action `auth.login.password`.
4. The Supabase auth service calls `supabase.auth.signInWithPassword(...)`.
5. Supabase returns a `user` object and a `session` object.
6. JSKIT syncs the app-side profile mirror from that Supabase user.
7. JSKIT writes the access and refresh tokens into HTTP-only cookies.
8. The API response sent back to the browser is intentionally small.

The important detail is step 7. The browser does **not** receive the raw Supabase session tokens as normal application state. The server writes them into cookies instead:

- `sb_access_token`
- `sb_refresh_token`

Those cookies are HTTP-only and `sameSite: "lax"`, so the browser sends them back automatically on later requests, but normal client-side code cannot read them directly.

The JSON response from `/api/login` is much smaller than the underlying Supabase session object:

```json
{
  "ok": true,
  "username": "alice"
}
```

After that, the browser still is not done. The login view immediately calls `/api/session` to confirm the session and fetch the current auth state. If that session check comes back with `authenticated: true`, the client redirects to the requested `returnTo` path.

So the real password-login round trip is:

```text
1. browser -> POST /api/login -> JSKIT app
2. JSKIT app -> supabase.auth.signInWithPassword(...)
3. Supabase -> JSKIT app: user + session
4. JSKIT app -> browser: set HTTP-only cookies + { ok, username }
5. browser -> GET /api/session
6. JSKIT app -> browser: { authenticated, username, csrfToken, ... }
7. browser redirects to the requested route
```

### OAuth login: the extra browser bounce

OAuth is the case where the browser really does leave the app briefly, but the app still owns the edges of the flow.

The first step is still browser -> app. If the login page shows a button such as `Continue with Google`, clicking it does **not** go straight to Supabase. It first goes to:

```text
/api/oauth/google/start?returnTo=/home
```

That server route does three jobs:

- normalizes the provider id
- normalizes the `returnTo` path
- asks Supabase for the correct provider redirect URL

JSKIT then redirects the browser to Supabase's OAuth flow. The redirect URL that JSKIT asks Supabase to use points back to your app, usually `/auth/login`, with some query parameters describing the provider and the intended return target.

So the browser flow becomes:

```text
browser -> /api/oauth/google/start
app -> Supabase OAuth redirect URL
browser -> Supabase / provider login page
Supabase -> browser back to /auth/login?...callback params...
```

When the browser lands back on `/auth/login`, the login page JavaScript inspects the URL. It looks for either:

- an OAuth `code`, or
- an access/refresh token pair

If it finds them, it does **not** treat the browser as fully signed in yet. Instead, it posts a small completion payload back to the app at:

```text
/api/oauth/complete
```

That payload looks roughly like one of these:

```json
{
  "provider": "google",
  "code": "..."
}
```

or

```json
{
  "provider": "google",
  "accessToken": "...",
  "refreshToken": "..."
}
```

Now the app server finishes the job:

1. `AuthController.oauthComplete()` receives the payload.
2. The Supabase auth service either:
   - exchanges the code with `supabase.auth.exchangeCodeForSession(...)`, or
   - restores the session with `supabase.auth.setSession(...)`
3. Supabase returns `user` and `session`.
4. JSKIT syncs the local profile mirror.
5. JSKIT writes HTTP-only cookies.
6. The browser strips the callback params out of the URL.
7. The browser refreshes `/api/session`.
8. The browser redirects to `returnTo`.

So the full OAuth dance is:

```text
browser -> app start route
app -> Supabase redirect
browser -> Supabase/provider
Supabase/provider -> browser back to /auth/login
browser -> app completion route
app -> Supabase session exchange
Supabase -> app: user + session
app -> browser: cookies + small success payload
browser -> /api/session -> redirect
```

That is why the login page needs both browser-side logic and server-side routes. The browser owns the redirect dance, but the app still owns the final session establishment step.

### What `/api/session` is really doing

`/api/session` is more than a yes-or-no login check. It is the app's current auth truth endpoint.

When the browser calls it, the server:

- reads the auth cookies
- checks whether the access token still looks valid
- refreshes the session through Supabase if needed
- clears invalid cookies if the session is no longer usable
- returns the auth state the client actually needs

The response is shaped roughly like this:

```json
{
  "authenticated": true,
  "username": "alice",
  "csrfToken": "...",
  "oauthProviders": [],
  "oauthDefaultProvider": null
}
```

That explains why the login screen and auth guard runtime both care about `/api/session`. It is how the browser learns:

- whether the user is authenticated
- which username to show
- which OAuth buttons to render
- which CSRF token to use for later writes

It is also why the shell widget can react cleanly to auth state without storing raw session tokens in client state. The browser just asks the app for the current session view, and the app derives that from its cookies plus Supabase.

### Authenticated Playwright testing with the dev auth bypass

JSKIT now ships a development-only auth bootstrap path specifically so authenticated UI can be verified in Playwright without depending on a real live login flow through Supabase.

This is the standard path the agent should use for authenticated browser tests:

- enable the dev auth bypass in development
- create a session for an existing user through the local app
- let the browser keep the resulting HTTP-only cookies
- navigate to the protected page and verify the feature
- record the Playwright run through `jskit app verify-ui` so `jskit doctor` can verify the receipt later

The feature is intentionally narrow.

- It is development-only.
- It must never be enabled in production.
- JSKIT rejects boot if `AUTH_DEV_BYPASS_ENABLED=true` while `NODE_ENV=production`.
- The route only looks up an existing user. It does not create one.

The environment variables are:

```bash
AUTH_DEV_BYPASS_ENABLED=true
AUTH_DEV_BYPASS_SECRET=replace-this-with-a-local-dev-secret
```

When enabled outside production, the app exposes:

```text
POST /api/dev-auth/login-as
```

The request body must contain either:

```json
{ "userId": "7" }
```

or:

```json
{ "email": "ada@example.com" }
```

The response is intentionally small:

```json
{
  "ok": true,
  "userId": "7",
  "username": "Ada Example",
  "email": "ada@example.com"
}
```

Behind the scenes, JSKIT creates the same HTTP-only auth cookies that the normal login flow would create. That means Playwright should not try to read raw tokens. It should bootstrap the session in the browser context, then navigate normally.

One subtle point matters here:

- `/api/dev-auth/login-as` is still an unsafe `POST`
- JSKIT still expects a CSRF token
- the browser can get that token from `/api/session`

So the normal Playwright shape is:

1. open a same-origin page first
2. call `/api/session` to read `csrfToken`
3. call `/api/dev-auth/login-as` with `credentials: "include"` and the `csrf-token` header
4. navigate to the protected route and run the assertions

For example:

```ts
await page.goto("/");

await page.evaluate(async ({ email }) => {
  const sessionResponse = await fetch("/api/session", {
    credentials: "include"
  });
  if (!sessionResponse.ok) {
    throw new Error(`Session bootstrap failed: ${sessionResponse.status}`);
  }

  const sessionPayload = await sessionResponse.json();
  const csrfToken = String(sessionPayload?.csrfToken || "");
  if (!csrfToken) {
    throw new Error("Missing csrfToken from /api/session.");
  }

  const loginResponse = await fetch("/api/dev-auth/login-as", {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "csrf-token": csrfToken
    },
    body: JSON.stringify({ email })
  });

  if (!loginResponse.ok) {
    throw new Error(`Dev login failed: ${loginResponse.status} ${await loginResponse.text()}`);
  }
}, { email: "ada@example.com" });

await page.goto("/w/acme/admin/contacts");
```

In practice, the preferred wrapper is:

```bash
npx jskit app verify-ui \
  --command "npx playwright test tests/e2e/contacts.spec.ts -g filters" \
  --feature "contacts filters" \
  --auth-mode dev-auth-login-as
```

That flow is preferable to driving the real sign-in form in feature tests because it keeps the test focused on the UI feature being added, not on an external auth dependency. If a chunk changes user-facing UI and the flow requires login, the expected JSKIT review standard is:

- use Playwright
- record the run with `jskit app verify-ui`
- use the local dev auth bypass or another local session bootstrap path
- exercise the actual changed behavior, not only page load

## What appears in Supabase

It is important to separate **Supabase auth data** from **JSKIT app-owned data**.

When a user registers from this screen, Supabase creates a real auth user immediately. According to Supabase's user-management docs, you can see users in two places.

- `Authentication -> Users` in the Supabase dashboard
- the `auth` schema in the Table Editor

In practice, after someone registers you should expect to see at least these things on the Supabase side.

- A user row exists in `auth.users`.
- The email address appears there.
- Supabase tracks whether the email has been confirmed yet.
- The user has a stable auth id.
- The provider is Supabase email/password unless you later add OAuth.

On the Dashboard's `Authentication -> Users` page, that usually means you will see a new user entry with the email address, creation time, last sign-in information once they have signed in, and confirmation state. If you open the user details, you can inspect the auth record more closely.

JSKIT's register flow also sends a starter `display_name` into Supabase user metadata. That means the new user can carry an initial display-name value in provider metadata even before the later database-backed users layer is installed.

This is the key distinction for the chapter.

- Supabase already has a real user record.
- JSKIT's own mirrored profile/settings store is still the temporary standalone in-memory version.

So if you restart the local JSKIT server in this chapter, the temporary app-side mirror is rebuilt as users authenticate again, but the actual Supabase auth user is still there because that data lives in Supabase, not in your local Node process.

One more subtle point matters here.

- If registration requires email confirmation, the user can already appear in Supabase even though the browser is not signed in yet.
- If confirmation is disabled, the user appears in Supabase and gets an active session immediately.

That is why the confirmation screen in the app should be understood as a **session-state** difference, not a sign that the user was never created.

## Summary

After this chapter, the app can really authenticate against Supabase. It has a public `auth` surface, a stock login page, a sign-out route, and a shell widget that reflects auth state. The provider-specific values now live in `.env`, and the web auth layer is wired into the same placement and surface system introduced earlier in the guide.

Just as importantly, the app is still deliberately incomplete. Authentication exists, but the database-backed user model does not. That separation is useful, because the next layer of the guide can explain users and persistence without having to also explain the first auth setup at the same time.
