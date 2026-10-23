# @jskit-ai/auth-provider-oidc-core

Sign people in to a JSKIT app through an OpenID Connect issuer instead of
app-local passwords: an accounts hub (`@jskit-ai/oidc-issuer-core`) or any
issuer such as Google Workspace or Okta. The app keeps its own `users` rows and
session; the issuer only proves who the person is.

```sh
npm uninstall @jskit-ai/auth-provider-local-core
npm install @jskit-ai/auth-provider-oidc-core @jskit-ai/auth-web
npm run db:migrate
```

| Name | Meaning |
|---|---|
| `AUTH_OIDC_ISSUER` | The issuer's address. |
| `AUTH_OIDC_REGISTRATION_TOKEN` | For an accounts hub: the hub's registration token. The app registers itself. |
| `AUTH_OIDC_CLIENT_ID`, `AUTH_OIDC_CLIENT_SECRET` | For other issuers, instead of the token. |
| `AUTH_OIDC_SESSION_SECRET` | At least 32 characters; required in production. |
| `APP_PUBLIC_URL` | The address people use; required in production behind a proxy. |

Without `AUTH_OIDC_ISSUER` the app still starts and the login page explains
what is missing. Inside a frame, such as an editor's preview, sign-in opens a
pop-up window. A production address waits for the hub owner's approval on the
hub's Apps page.

`npx jskit-oidc-sign-in export-local-accounts` and `adopt-oidc` move existing
JSKIT local accounts to a hub, keeping ids and passwords. Run them only on the
app owner's explicit request.

Follow the `auth/oidc-sign-in` pattern and the guide "Sign in through an OIDC
issuer" in the JSKIT guide (`packages/agent-docs/site/guide/app-setup/`).
