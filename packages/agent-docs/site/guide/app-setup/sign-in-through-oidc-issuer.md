# Sign in through an OIDC issuer

Use this when an app should not keep its own passwords: people sign in with
the account they already have in an accounts hub (see
[Run an accounts hub](/guide/app-setup/run-an-accounts-hub)) or in any OpenID
Connect issuer, such as Google Workspace or Okta. The app still keeps its own
`users` rows and its own session; the issuer only proves who the person is.

The pattern is `auth/oidc-sign-in`.

## Install

Replace the local provider; an app has exactly one `auth.service` provider.

```bash
npm uninstall @jskit-ai/auth-provider-local-core
npm install @jskit-ai/auth-provider-oidc-core @jskit-ai/auth-web
npm run db:migrate
```

The migration adds `auth_oidc_clients`, `auth_oidc_sessions` and
`auth_oidc_logout_tokens`. Existing local tables are left alone; move the
accounts first (below) if the app already has people.

## Env

| Name | Meaning |
|---|---|
| `AUTH_OIDC_ISSUER` | The issuer address. Its discovery document supplies everything else. |
| `AUTH_OIDC_REGISTRATION_TOKEN` | Preferred. The app registers itself with the issuer, once per address. |
| `AUTH_OIDC_CLIENT_ID` / `AUTH_OIDC_CLIENT_SECRET` | For issuers without self-registration. Use these **instead of** the token, never both. |
| `AUTH_OIDC_LABEL` | Button label. Default "Continue with your account". |
| `AUTH_OIDC_SESSION_SECRET` | Required in production, at least 32 characters. In development it is generated in `.jskit/auth/oidc-session.secret`. |
| `APP_PUBLIC_URL` | The address people use. With it the app registers at start; without it, on the first sign-in from a new address. Required in production behind a proxy that is not on the same machine. |

Addresses must be `https`, or `http` on `localhost`/loopback. Without
`AUTH_OIDC_ISSUER` the app still starts; pressing the button brings the person
back to the login page with "Sign-in is not set up yet: AUTH_OIDC_ISSUER is
missing." Every sign-in that cannot start is explained there the same way.

In a Vibe64 project, link these from saved values in **Keys & accounts**
instead of pasting them: `AUTH_OIDC_ISSUER` to the hub's `issuer` and
`AUTH_OIDC_REGISTRATION_TOKEN` to its `registrationToken`.

## What the issuer is told

When registering, the app sends:

| Field | Value |
|---|---|
| `redirect_uris` | `<address>/auth/login` (`AUTH_OIDC_REDIRECT_PATH`) |
| `post_logout_redirect_uris` | `<address>/` |
| `backchannel_logout_uri` | `<address>/api/auth/oidc/backchannel-logout` |
| `token_endpoint_auth_method` | `client_secret_basic` |
| `grant_types` / `response_types` | `authorization_code` / `code` |

Scopes are `openid email profile`. A static client must be registered with the
same redirect URI.

An accounts hub decides what a new address may do. Development addresses work
at once. A production address waits until the hub's owner approves it on the
hub's Apps page; until then, signing in shows the hub's own waiting page. A
blocked address cannot register, and the login page says "Your accounts hub has
blocked this app's address."

## Signing in

The login page shows one button. Unframed, it goes to the issuer and comes back
to `/auth/login`, then to the page the person started from. Inside a frame,
such as an editor Preview, the issuer cannot be shown, so the button opens a
pop-up window instead; when the pop-up finishes, it closes and the framed page
reloads signed in. If the browser blocks the pop-up the page says so.

Each attempt is bound to the browser that started it by a sealed ten-minute
cookie and checked with PKCE, `state`, `nonce` and the issuer's `iss`; a stale
or foreign attempt reads "This sign-in took too long or started in another
browser. Start again."

The first sign-in creates the `users` row (`auth_provider` `oidc`,
`auth_provider_user_sid` the issuer's subject) with the email and name.

## Signing out

- Ordinary sign-out ends the app session only.
- `/api/auth/oidc/logout?everywhere=1` (a same-site link) also ends the issuer
  session and returns to `/`.
- The issuer can end app sessions itself: disabling an account in the hub posts
  a signed logout token to the back-channel URI, and the person's sessions in
  this app end at once.

## Preview identity

Keep the standard managed-preview login (`tools/preview-identity`, see
[Authentication](/guide/app-setup/authentication)). It signs the Preview in as
an existing `users` row without visiting the issuer, so tests do not need a
hub account. It cannot create users.

## Move existing local accounts

Only with the app owner's explicit yes. On the app (local provider still
installed):

```bash
npx jskit-oidc-sign-in export-local-accounts --out accounts.jsonl
```

This writes one JSON line per account, readable only by you, and refuses to
overwrite a file. Import that file into the hub (`jskit-oidc-issuer
import-accounts`, see the hub guide). Then switch the provider as above and
mark the same people as hub accounts:

```bash
npx jskit-oidc-sign-in adopt-oidc --issuer "$AUTH_OIDC_ISSUER" --in accounts.jsonl
npx jskit-oidc-sign-in adopt-oidc --issuer "$AUTH_OIDC_ISSUER" --in accounts.jsonl --apply
```

The first run only counts what would change; `--apply` changes it. Ids stay the
same, so existing data keeps its owners. Delete `accounts.jsonl` afterwards: it
contains password hashes.

## Verification

- Sign in unframed and in the Preview; refresh stays signed in.
- Sign out, then sign out everywhere.
- Disable the account in the hub and confirm the app session ends.
- Preview identity still signs in.
