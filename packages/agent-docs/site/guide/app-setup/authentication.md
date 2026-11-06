# Authentication

JSKIT separates provider-neutral authentication behavior, one selected identity
provider, and the browser authentication surface.

For local authentication:

```bash
npm install @jskit-ai/auth-provider-local-core @jskit-ai/auth-web
```

For Supabase authentication:

```bash
npm install @jskit-ai/auth-provider-supabase-core @jskit-ai/auth-web
```

To sign in through an accounts hub or another OpenID Connect issuer (see
[Sign in through an OIDC issuer](/guide/app-setup/sign-in-through-oidc-issuer)):

```bash
npm install @jskit-ai/auth-provider-oidc-core @jskit-ai/auth-web
```

The dependency graph supplies `@jskit-ai/auth-core`. Do not install two
providers for the same `auth.service` capability.

## Provider ownership

The selected provider owns identity verification and sessions. The application
owns permitted login methods, visible OAuth providers, public routes,
post-login destinations, surface access policy, and secret injection.

Use the `auth/auth-surface` pattern for login, sign-out, reset, guards, profile
placements, HTTP integration, and the managed-preview login. Use
`auth/supabase-auth` for the Supabase environment and configuration shape, and
`auth/oidc-sign-in` for an OpenID Connect issuer.

## Managed-preview login is standard

An application with accounts always includes the managed-preview login, whether
or not anyone asked for it. Adding authentication adds both parts from the
`auth/auth-surface` pattern:

- the committed, executable `tools/preview-identity` from its example, which
  passes `runManagedPreviewIdentityCommand` the preview host's protocol id, the
  hostnames, besides loopback, that the host serves the app on, and the process
  environment;
- its declaration to the preview host in the form that host reads (for a host
  that reads the web `Outputs` target, the pattern's `#### Preview identity`
  block: Command `tools/preview-identity`, the same protocol id, Identity types
  `email` `user-id`, Enabled environment `AUTH_DEV_BYPASS_ENABLED`, Secret
  environment `AUTH_DEV_BYPASS_SECRET`, Runtimes `nodejs`).

The preview host supplies both environment values per run, so a managed
preview can sign its browser in as an existing account. Which accounts it may
use stays the person's choice; the application never creates users for it, and
the exchange is inert without both values.

## Server boundary

`@jskit-ai/auth-core` exposes the policy, actor, extension, and action contracts.
Protected server operations declare an auth policy; they do not trust a hidden
button or a page-local session check. Other packages extend auth through the
public extension capability rather than replacing the auth service.

## Sign-in protection

Two limits slow down password guessing, and both are on by default.

**Per client address.** Every auth route that can be abused by repetition
declares a `rateLimit`, which the kernel enforces for each client address. A
request over it is refused with status 429, the code `kernel.http.rateLimited`
(`params.count` is the seconds to wait) and a `Retry-After` header. The
defaults, per minute: `login`, `register`, `loginOtpRequest` and
`loginOtpVerify` 10; `registerConfirmationResend` and `passwordForgot` 5;
`oauthStart`, `oauthComplete`, `passwordRecovery` and `passwordReset` 20;
`devLoginAs` 30. Change one in the application's server configuration;
`false` removes it:

```js
// config/server.js
config.auth = {
  ...config.auth,
  rateLimits: {
    login: { max: 5, timeWindow: "1 minute" },
    oauthStart: false
  }
};
```

A route name auth does not have, or a value that is neither
`{ max, timeWindow }` nor `false`, stops startup. `timeWindow` is milliseconds
or text such as `"30 seconds"` or `"1 hour"`.

The address is Fastify's `request.ip`. Behind a reverse proxy every request
comes from the proxy, so all clients would share one count: create Fastify with
`trustProxy` set to the proxy's address (for example
`Fastify({ trustProxy: "127.0.0.1" })`), and never to `true` when clients can
also reach the server directly.

**Per account (local auth).** After 5 failed sign-ins in a row for one email,
that email must wait 30 seconds before its next attempt; each further failure
doubles the wait, up to an hour (NIST SP 800-63B's example). While it waits,
sign-in is refused, even with the right password, with status 429, the code
`auth.local.login.locked` (`params.count` minutes, `params.retryAfterSeconds`)
and `Retry-After`. Emails without an account are counted the same way, so the
wait says nothing about which accounts exist. A successful sign-in forgets the
failures, and so does a day without one. Waits are temporary and password
recovery is never blocked: completing a password reset ends the wait, so an
attacker who keeps an account waiting cannot keep its owner out. The failures
are kept in the file store (`sign-in-failures.passwd`) or, with
`@jskit-ai/auth-provider-local-db-core`, in the `auth_local_sign_in_failures`
table (run `npm run db:migrate`).

| Env | Default | Meaning |
| --- | --- | --- |
| `AUTH_LOCAL_SIGN_IN_FAILURES_BEFORE_WAIT` | `5` | Failed sign-ins in a row before the account waits, 1 to 100. |
| `AUTH_LOCAL_SIGN_IN_FIRST_WAIT_SECONDS` | `30` | The first wait. |
| `AUTH_LOCAL_SIGN_IN_MAX_WAIT_SECONDS` | `3600` | The longest wait, at least the first. |
| `AUTH_LOCAL_PASSWORD_MIN_LENGTH` | `8` | The shortest password local auth accepts, 8 to 64. |

NIST SP 800-63B-4 asks for at least 15 characters when a password is the only
sign-in factor, and at least 8 when it is used with another factor; set
`AUTH_LOCAL_PASSWORD_MIN_LENGTH=15` for password-only sign-in. Passwords up to
128 characters are accepted.

The login page shows either refusal, translated, with the wait.

## Application-owned recovery email

Local auth owns recovery tokens, expiry and recovery-scoped sessions. The
application supplies the optional `auth.local.recovery-sender` capability as an
async function accepting `{ email, recoveryUrl }`. It owns message content,
sender address, provider credentials and delivery. The function must reject on
failure and must not log the recovery URL or raw provider credentials.

Wire the application's selected email integration or transport into this
capability using an ordinary application provider:

```js
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createRecoverySender } from "./recoverySender.js";

export const RecoveryEmailProvider = defineProvider({
  id: "app.recovery-email",
  requires: { mail: "app.mail" },
  provides: { recoverySender: "auth.local.recovery-sender" },
  /** @param {{ mail: import("@local/mail/server/types").AppMail }} capabilities */
  setup({ mail }) {
    return { recoverySender: createRecoverySender({ mail }) };
  }
});
```

```js
// recoverySender.js
/** @param {{ mail: import("@local/mail/server/types").AppMail }} dependencies */
function createRecoverySender({ mail }) {
  /** @type {import("@jskit-ai/auth-provider-local-core/server/types").AuthLocalRecoverySender} */
  async function sendRecoveryEmail({ email, recoveryUrl }) {
    await mail.send({
      to: email,
      subject: "Reset your password",
      text: `Open this link to reset your password:\n\n${recoveryUrl}\n`
    });
  }

  return sendRecoveryEmail;
}

export { createRecoverySender };
```

`app.mail` is an application-owned capability in this example, not a built-in
JSKIT email API. Its `send()` implementation owns the selected integration,
credential resolution and safe error mapping. A connected account or a domain
listing adapter alone does not implement email sending. Install this provider
alongside the application's mail provider and `AuthLocalProvider`.
[Typed features](/guide/framework/typed-features) describes how application
providers name and type the capabilities they receive.
For direct library composition, pass the same function as `recoverySender` to
`createLocalAuthService()`, with a configuration from
`resolveLocalAuthConfig({ appRoot, env, fileBackend, emailRecovery: true })`.

Set `APP_PUBLIC_URL` to the application's actual public URL. When a sender is
configured, auth requires this value and does not return or log the recovery
URL. Without a sender, production recovery is disabled; explicit development
output remains available for local testing. A sender failure never falls back
to development output. The generic recovery delivery capability is `email`.

### Pre-release migration

This is a V0 breaking change. There is one runtime path, with no old SMTP reader
or compatibility adapter.

1. Supply `auth.local.recovery-sender` (or the direct `recoverySender` argument)
   using your application’s chosen delivery implementation.
2. Move sender, reply-to and transport credentials into that implementation's
   configuration and private Env. Remove `AUTH_LOCAL_SMTP_HOST`,
   `AUTH_LOCAL_SMTP_PORT`, `AUTH_LOCAL_SMTP_SECURE`, `AUTH_LOCAL_SMTP_USER`,
   `AUTH_LOCAL_SMTP_PASSWORD`, `AUTH_LOCAL_SMTP_FROM` and
   `AUTH_LOCAL_SMTP_REPLY_TO`. These variables are no longer consumed by auth.
3. If retaining SMTP, explicitly install Nodemailer in the application and own
   its transport there. Local auth no longer installs or imports Nodemailer.
4. Retain `APP_PUBLIC_URL`. Replace direct-service `config.smtp` and
   `config.smtpConfigured` with the sender argument. Update consumers that
   inspect `features.passwordRecovery.delivery` from `smtp` to `email`, including
   Supabase-backed consumers: this describes delivery, not transport protocol.
5. Verify recovery delivery, unknown-account responses, delivery failures and
   the completed password-reset flow before releasing the updated application.
   This change does not alter identity, session or recovery-token storage.

## Google, Microsoft and GitHub sign-in with local auth

Local auth signs people in through Google, Microsoft and GitHub when the
application sets each provider's client id and secret in private Env:

| Provider | Env pair | Protocol and scopes |
| --- | --- | --- |
| Google | `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET` | OpenID Connect discovery, `openid email profile` |
| Microsoft | `AUTH_MICROSOFT_CLIENT_ID`, `AUTH_MICROSOFT_CLIENT_SECRET` | OpenID Connect discovery through the `common` endpoint, `openid email profile` |
| GitHub | `AUTH_GITHUB_CLIENT_ID`, `AUTH_GITHUB_CLIENT_SECRET` | OAuth 2.0, `read:user user:email`, email from `GET /user/emails` |

A provider appears in `oauthLogin.providers` only when both values of its pair
are set; setting one without the other stops startup. `APP_PUBLIC_URL` is then
required, and every provider's app registration must allow exactly
`${APP_PUBLIC_URL}/auth/login` as its redirect address. The login page posts the
callback to `/api/oauth/complete`, which completes the provider the attempt
started with.

Register the Microsoft app for accounts in any organizational directory and
personal Microsoft accounts, and add the optional ID token claim `xms_edov`.

Security behavior:

- The authorization-code flow uses PKCE (`S256`) and `state`, plus `nonce` for
  OpenID Connect. The attempt is stored server-side, in the file store or the
  `auth_local_oauth_attempts` table, under the hash of a random httpOnly
  `jskit_local_oauth_attempt` cookie (`__Host-` in production), so it completes
  only in the starting browser and works across several servers. It is deleted
  when used and expires after ten minutes.
- ID tokens are verified against the provider's JWKS: signature, issuer,
  audience, expiry and nonce.
- Only a verified email signs in: Google's `email_verified`, GitHub's primary
  verified address, and for Microsoft a personal account or a work or school
  account whose token carries `xms_edov: true`. A Microsoft token without an
  email claim is refused.
- `returnTo` must be on the application's own origin; anything else returns to
  `/`.

A sign-in matches the provider subject first. Otherwise a verified email that
matches an existing user signs that user in and links the provider identity,
and a new email creates the user the way `register` does: the
`auth.local.user.registered` hook runs and profile synchronization provisions
the personal workspace. An account created this way has no password until
password recovery sets one. Sessions are ordinary local sessions; provider
tokens are discarded after sign-in.

With providers configured, the `providerLinking` capability is on. The security
status lists each provider as an `oauth:<provider>` method, where `canEnable`
means it can be linked and `canDisable` that it can be unlinked.
`GET /api/settings/security/oauth/:provider/start` links a provider to the
signed-in account and `DELETE /api/settings/security/oauth/:provider` unlinks
it. Unlinking the last sign-in method is refused, and so is linking an identity
that already belongs to another account. The `users/account-settings` pattern's
sign-in methods section offers both.

With `@jskit-ai/auth-provider-local-db-core`, run `npm run db:migrate` to create
the `auth_local_identities` and `auth_local_oauth_attempts` tables.

## Browser boundary

`@jskit-ai/auth-web` owns the normal auth views, guard runtime, sign-out flow,
and auth-aware HTTP integration. Applications may wrap and style those views
while retaining the behavior contract.

Initial load errors stay inside the affected surface. Failed login, reset, and
other transient mutations use the application toast and do not shift the form.
Loading uses skeletons when content geometry is known.

## Verification

Test successful and failed registration/login, sign-out, password reset,
protected direct navigation, return destinations, refresh, expired sessions,
and negative cross-origin behavior. For Supabase, also exercise callback and
refresh flows.

For direct localhost Playwright tests, enable the development auth bypass only
in the server process and use `loginAsExistingUser()` from
`@jskit-ai/auth-web/test/playwright`. The Node-side helper sends the private
`x-jskit-dev-auth-secret`; never pass that secret through browser code, URLs, or
client environment.

A managed host instead supplies authenticated state through
`PLAYWRIGHT_STORAGE_STATE` and the app-owned Playwright config. Treat the
file as a temporary secret, use relative URLs, and do not call the localhost
login helper or start a duplicate server.

The login state belongs to the host, which already fits it to the tested site.
Pass `process.env.PLAYWRIGHT_STORAGE_STATE` unchanged to `use.storageState`:
the config never reads, parses or edits that file or its `cookies` or
`origins`. `jskit/playwright-login-unchanged` reports a config that does, and
the host refuses to run its tests. If tests run signed out with the unchanged
state, that is a host defect: report it with the evidence; do not work around
it.

Never commit provider secrets, copy auth repositories into the app, or add an
installation questionnaire, mutation record, or setup receipt.
