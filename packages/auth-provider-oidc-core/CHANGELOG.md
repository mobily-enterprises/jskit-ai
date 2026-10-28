# Changelog

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".

### New message keys (15)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.auth.oidc.setup.issuerMissing`
- `jskit.auth.oidc.setup.clientMissing`
- `jskit.auth.oidc.issuer.unreachable`
- `jskit.auth.oidc.issuer.blocked`
- `jskit.auth.oidc.issuer.tokenRefused`
- `jskit.auth.oidc.request.noAddress`
- `jskit.auth.oidc.request.publicUrlRequired`
- `jskit.auth.oidc.signIn.providerInvalid`
- `jskit.auth.oidc.signIn.emailMissing`
- `jskit.auth.oidc.signIn.emailUnconfirmed`
- `jskit.auth.oidc.signIn.cancelled`
- `jskit.auth.oidc.signIn.incomplete`
- `jskit.auth.oidc.signIn.expired`
- `jskit.auth.oidc.signIn.codeRequired`
- `jskit.auth.oidc.signIn.unverified`

</details>

### Codes (15)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `auth.oidc.setup.issuerMissing` | Sign-in is not set up yet: AUTH_OIDC_ISSUER is missing. |
| `auth.oidc.setup.clientMissing` | Sign-in is not set up yet: set AUTH_OIDC_REGISTRATION_TOKEN, or AUTH_OIDC_CLIENT_ID and AUTH_OIDC_CLIENT_SECRET. |
| `auth.oidc.issuer.unreachable` | Your accounts hub can't be reached right now. Try again in a moment. |
| `auth.oidc.issuer.blocked` | Your accounts hub has blocked this app's address. |
| `auth.oidc.issuer.tokenRefused` | Your accounts hub refused this app's registration token. Check AUTH_OIDC_REGISTRATION_TOKEN. |
| `auth.oidc.request.noAddress` | This request has no usable address. |
| `auth.oidc.request.publicUrlRequired` | Set APP_PUBLIC_URL so sign-in returns to this app's https address. |
| `auth.oidc.signIn.providerInvalid` | OAuth provider must be {provider}. |
| `auth.oidc.signIn.emailMissing` | Your account provider did not share an email address. |
| `auth.oidc.signIn.emailUnconfirmed` | Your account provider has not confirmed your email address yet. Confirm it there, then sign in again. |
| `auth.oidc.signIn.cancelled` | Sign-in was cancelled. |
| `auth.oidc.signIn.incomplete` | Sign-in was not completed. Start again. |
| `auth.oidc.signIn.expired` | This sign-in took too long or started in another browser. Start again. |
| `auth.oidc.signIn.codeRequired` | OAuth code is required. |
| `auth.oidc.signIn.unverified` | Your sign-in could not be verified. Start again. |
