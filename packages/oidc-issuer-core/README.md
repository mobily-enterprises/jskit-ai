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

Guides: "Run an accounts hub" and "Sign in through an OIDC issuer" in the JSKIT
guide (`packages/agent-docs/site/guide/app-setup/`).
