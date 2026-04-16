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

- The title changes from `Welcome back` to `Create your account`.
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

That is why the login card in this chapter does not show buttons like `Continue with Google`. If later you enable a provider in Supabase and list it in `config.auth.oauth.providers`, the same screen can render those buttons automatically.

<DocsTerminalTip label="Important" title="What Works Without A Database">
Authentication works at this stage because Supabase stores the real identity data, passwords, and sessions.

What does **not** exist yet is JSKIT's database-backed users layer. Until later chapters install the database and users packages, the app-side profile mirror and user-settings storage use standalone in-memory fallbacks. That means:

- auth itself is real
- Supabase still stores the real auth user, password state, and session state
- app-owned mirrored profile/settings data is not persistent yet
- restarting the local server clears that JSKIT-side in-memory mirror
- there is still no account surface, no user settings UI, and no workspace membership model

So this chapter gives you real authentication, but not yet the full app user model.
</DocsTerminalTip>

## Under the hood

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
