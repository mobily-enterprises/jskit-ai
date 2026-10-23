# Run an accounts hub

An accounts hub gives one person or company a single sign-in for all of their
apps. It is an OpenID Connect issuer that runs as its **own** JSKIT project, on a
domain of its own. Apps sign in through it like they would through Google: the
hub shows its sign-in page, the app receives an ID token, and the app keeps its
own session.

```bash
npm install @jskit-ai/oidc-issuer-core @jskit-ai/database-runtime-mysql
```

Start from the "JSKIT · Accounts hub" template (seed-jskit branch
`accounts-hub`) when you can: it already has the pages, the Stack and the tests.
Use the `auth/accounts-hub` pattern for the composition rules. Apps connect with
`@jskit-ai/auth-provider-oidc-core`; see
[Sign in through an OIDC issuer](/guide/app-setup/sign-in-through-oidc-issuer).

## In order

1. Create the hub from the template, with its own database.
2. Development: set `OIDC_HUB_OWNER_EMAIL` (ask the person), a random
   `OIDC_HUB_REGISTRATION_TOKEN` and, if the database is shared or kept,
   `OIDC_HUB_SECRET`. Start it, create the owner account and confirm it (the
   link is in the server log without a sender). Run the tests.
3. Production: choose the hub's own domain and set `APP_PUBLIC_URL`, a new
   `OIDC_HUB_SECRET`, the same registration token the apps will use, the owner
   email, an email sender and `OIDC_HUB_DEV_ORIGIN_PATTERNS` for the apps'
   development previews.
4. Deploy, then sign in as the owner and follow **Setup** until every item is
   ready. Only then connect apps (see [Connecting an app](#connecting-an-app)).

Report Setup honestly: do not say email or Google works until its Setup item is
ready.

## What the hub does

- **Sign-in for apps.** `/.well-known/openid-configuration` and `/oidc/*` serve a
  hardened `oidc-provider`: authorization code with PKCE only, exact redirect
  URIs, ES256 ID tokens that include `email`, `email_verified` and `name`, no
  refresh tokens for apps, `iss` in every authorization response, RP-initiated
  and back-channel logout.
- **Accounts.** Email and password (scrypt v1, the same format as JSKIT local
  accounts), email confirmation, password recovery, and optional "Continue with
  Google" with the owner's own Google client.
- **Approval.** Apps register themselves at `/oidc/reg` with the registration
  token. Loopback and development addresses are approved automatically; every
  other address waits until the owner clicks Approve on the hub's Apps page.
- **Admin pages.** Apps (approve, block, remove, rotate the signing key), People
  (turn accounts off, which signs them out of every app through back-channel
  logout) and Setup (a checklist of what is ready).

## Environment

| Name | Required | Meaning |
|---|---|---|
| `APP_PUBLIC_URL` | production | The hub's origin, which is its issuer. https outside this computer, no path. |
| `OIDC_HUB_SECRET` | production | At least 32 random bytes. Protects cookies and the stored signing keys; never change it once set. Development generates one in `.jskit/oidc-hub/secret`, so set it explicitly whenever the database outlives that folder (a hosted editor, several checkouts sharing one database). |
| `OIDC_HUB_REGISTRATION_TOKEN` | yes | At least 24 characters. Apps present it to register. Give the same value to each app as `AUTH_OIDC_REGISTRATION_TOKEN`. |
| `OIDC_HUB_OWNER_EMAIL` | yes | The owner's email. That account, once its email is confirmed, opens the admin pages. |
| `OIDC_HUB_DEV_ORIGIN_PATTERNS` | no | Comma-separated `https://` origin globs approved automatically, for example `https://preview-*.acme.example.dev`. `*` matches inside one DNS label. Loopback is always approved. |
| `OIDC_HUB_EMAIL_FROM` with `RESEND_API_KEY` or `SMTP_URL` | production | The owner's own sender. In development, without a sender, emails are written to the server log. |
| `OIDC_HUB_GOOGLE_CLIENT_ID` and `OIDC_HUB_GOOGLE_CLIENT_SECRET` | no | Turn on "Continue with Google". The Google redirect URI is `{APP_PUBLIC_URL}/hub/google/callback`. |

Each problem stops the hub with one sentence that names the variable to fix.

## Mounting

The installed `OidcIssuerProvider` mounts everything on the app's Fastify
server. A server that filters paths by surface must also serve the hub's
paths:

```js
import { HUB_GLOBAL_PATHS } from "@jskit-ai/oidc-issuer-core/server";

registerSurfaceRequestConstraint({
  fastify: app,
  surfaceRuntime,
  serverSurface,
  globalUiPaths: [...runtimeGlobalUiPaths, ...HUB_GLOBAL_PATHS]
});
```

The hub's own pages are ordinary Vue pages. They call `/hub/api/*` with
`x-hub-request: 1` on every state-changing request. An app's sign-in arrives at
`/hub/interaction/:uid`, which sends the browser to `/auth/sign-in?interaction=…`.
That page reads `/hub/interaction/:uid/details` (app name, full address and
status) and finishes with `/hub/interaction/:uid/continue` once the person is
signed in.

## Registration and approval

A registration carries only `client_name` (at most 80 characters),
`redirect_uris`, `post_logout_redirect_uris`, `backchannel_logout_uri`,
`token_endpoint_auth_method` (`client_secret_basic`), `grant_types`
(`["authorization_code"]`) and `response_types` (`["code"]`). Every address must
be on one origin, https unless it is loopback. Anything else is refused with
`invalid_client_metadata`.

| Address | Status |
|---|---|
| Loopback, or matching `OIDC_HUB_DEV_ORIGIN_PATTERNS` | `active-dev`: works at once; removed after 30 idle days |
| An origin the owner already approved | `active` |
| Any other origin | `pending`: the person sees "This app is waiting for approval by the hub's owner." |
| A blocked origin | refused with 403 "This address is blocked by the hub's owner." |

The response header `x-hub-client-status` tells the registering app its status.

## Commands

Run them from the hub project's folder; they read its `.env` and database
settings.

```bash
npx jskit-oidc-issuer keys rotate
npx jskit-oidc-issuer import-accounts --in accounts.jsonl          # dry run
npx jskit-oidc-issuer import-accounts --in accounts.jsonl --apply
```

- `keys rotate` makes a new ES256 key active. The previous key keeps verifying
  for two hours, then leaves the JWKS. The Apps page has the same button.
- `import-accounts` reads the JSON Lines written by
  `jskit-oidc-sign-in export-local-accounts`. It keeps each `usr_` id as the
  hub's `sub` and each scrypt password byte for byte, so people sign in with the
  password they already had. Emails start unconfirmed. Rows that clash with a
  different hub account are refused and listed. A dry run prints only counts.
- `preview-identity` implements `vibe64.preview-identity.command.v1` for the
  hub, so an editor's preview can sign in as an existing hub account. It works
  only outside production, from loopback, with `AUTH_DEV_BYPASS_ENABLED` and
  `AUTH_DEV_BYPASS_SECRET`.

## Connecting an app

1. Install `@jskit-ai/auth-provider-oidc-core` in the app.
2. Give the app `AUTH_OIDC_ISSUER` (the hub's `APP_PUBLIC_URL`) and
   `AUTH_OIDC_REGISTRATION_TOKEN` (the hub's `OIDC_HUB_REGISTRATION_TOKEN`).
3. Sign in once from the app. A development address works straight away. After
   the app is deployed, open the hub's Apps page and approve it at its full
   address.

## Verify

- Start the hub with one variable missing and read the sentence it prints.
- A loopback app registers as `active-dev` and signs in.
- An https app on another domain waits until Approve, then signs in.
- Setup shows every item ticked once the owner confirms the domain and sends a
  test email.
