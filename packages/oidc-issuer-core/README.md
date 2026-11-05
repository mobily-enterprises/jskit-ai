# @jskit-ai/oidc-issuer-core

An accounts hub for a JSKIT app: one sign-in for all of an owner's apps. The
hub is an OpenID Connect issuer that runs as its own project on a domain of its
own. People create one account there (email and password, optional "Continue
with Google" with the owner's own Google client); the owner approves each app
that wants to use those accounts.

Start from the **JSKIT · Accounts hub** template (seed-jskit branch
`accounts-hub`): it has the sign-in, account and admin pages, the tests and a
quick start. To build a hub by hand, follow the `auth/accounts-hub` pattern.

```sh
npm install @jskit-ai/oidc-issuer-core @jskit-ai/database-runtime-mysql
```

The settings that matter, in the order a new hub needs them:

| Name | Meaning |
|---|---|
| `OIDC_HUB_OWNER_EMAIL` | The owner's email. That account, once confirmed, opens Apps, People and Setup. |
| `OIDC_HUB_REGISTRATION_TOKEN` | At least 24 random characters. Every app presents it to register. |
| `OIDC_HUB_SECRET` | At least 32 random bytes; required in production, never changed once set. |
| `APP_PUBLIC_URL` | The hub's https address, which is its issuer. Required in production. |
| `OIDC_HUB_EMAIL_FROM` with `RESEND_API_KEY` or `SMTP_URL` | The owner's own sender. Required in production. |
| `OIDC_HUB_DEV_ORIGIN_PATTERNS` | Optional `https://` globs of development addresses approved automatically. |

A missing or wrong setting stops the hub with one sentence that names it.

Apps connect with `@jskit-ai/auth-provider-oidc-core` and two values: the hub's
address and its registration token.

Commands, run from the hub project: `npx jskit-oidc-issuer keys rotate` and
`npx jskit-oidc-issuer import-accounts --in accounts.jsonl [--apply]` (a dry run
unless `--apply`).

## Languages

The hub's texts are message keys under `jskit.accounts.*`, with their English
in `locales/en.json` (exported as `./locales/en.json`). With no translations
everything stays in that English.

- **Choosing the language.** A page or email uses the first language the hub
  has a translation for, in this order: the app's `ui_locales` on the
  authorization request (for the sign-out, signed-out and sign-in problem
  pages), then the browser's `Accept-Language`, then English. `it-CH` uses an
  `it` translation. Emails follow the request that sent them, since hub
  accounts keep no saved language. `GET /hub/interaction/:uid/details` answers
  `locale` so the hub project's own sign-in pages can show the same language.
- **Translating.** Put the translations in the hub project's
  `src/locales/<code>/jskit.json` (the file `jskit i18n export <code>` writes).
  The hub reads them once per process. Pages carry `<html lang>`.
- **Rewording English.** `src/locales/en/jskit.json` overrides the bundled
  English. A hub built directly with `createOidcIssuer` can also pass
  `catalogs`, extra English catalogs merged over the bundled one.
- **API refusals.** The hub's API answers in English with its `error` code,
  plus `messageCode` and `messageParams`, so a JSKIT page translates the
  sentence with `serverMessage`.

Guides: "Run an accounts hub" and "Sign in through an OIDC issuer" in the JSKIT
guide (`packages/agent-docs/site/guide/app-setup/`).
