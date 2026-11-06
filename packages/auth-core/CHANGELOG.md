# Changelog

## Unreleased

- The auth policy no longer registers `@fastify/rate-limit`, which it did after the routes existed, so no route limit applied; the kernel now registers it before the routes and enforces each route's `rateLimit`.

- Every auth command's field messages (sign-in, registration, one-time codes, OAuth, password reset and recovery, dev sign-in) are sent in the coded form `{ code, message, params }`, so their field errors translate. The English is unchanged.
- The default access-denied texts carry the messageCodes `auth.denied.notAllowlistedDefault`, `auth.denied.blockedDefault` and `auth.denied.unspecified`; `./shared/authDenied` adds `AUTH_DENIED_DEFAULT_TEXTS` and `AUTH_DENIED_FALLBACK_TEXT` (`{ message, messageCode }`). `AUTH_DENIED_DEFAULT_MESSAGES` and the English are unchanged.

### New codes (22)

<details><summary>Code list</summary>

- `auth.dev.userIdInvalid`
- `auth.dev.userInvalid`
- `auth.validation.unexpectedField`
- `auth.validation.emailAddressInvalid`
- `auth.validation.passwordMinLength`
- `auth.validation.oauthProviderRequired`
- `auth.validation.oauthProviderInvalid`
- `auth.validation.oauthCodeInvalid`
- `auth.validation.oauthStateInvalid`
- `auth.validation.oauthIssuerInvalid`
- `auth.validation.accessTokenInvalid`
- `auth.validation.refreshTokenInvalid`
- `auth.validation.returnToInvalid`
- `auth.validation.otpCodeRequired`
- `auth.validation.otpTokenHashInvalid`
- `auth.validation.otpTypeUnsupported`
- `auth.validation.recoveryCodeInvalid`
- `auth.validation.recoveryTokenHashInvalid`
- `auth.validation.recoveryTypeUnsupported`
- `auth.denied.notAllowlistedDefault`
- `auth.denied.blockedDefault`
- `auth.denied.unspecified`

</details>

### New message keys (22)

<details><summary>Key list</summary>

- `jskit.auth.dev.userIdInvalid`
- `jskit.auth.dev.userInvalid`
- `jskit.auth.validation.unexpectedField`
- `jskit.auth.validation.emailAddressInvalid`
- `jskit.auth.validation.passwordMinLength`
- `jskit.auth.validation.oauthProviderRequired`
- `jskit.auth.validation.oauthProviderInvalid`
- `jskit.auth.validation.oauthCodeInvalid`
- `jskit.auth.validation.oauthStateInvalid`
- `jskit.auth.validation.oauthIssuerInvalid`
- `jskit.auth.validation.accessTokenInvalid`
- `jskit.auth.validation.refreshTokenInvalid`
- `jskit.auth.validation.returnToInvalid`
- `jskit.auth.validation.otpCodeRequired`
- `jskit.auth.validation.otpTokenHashInvalid`
- `jskit.auth.validation.otpTypeUnsupported`
- `jskit.auth.validation.recoveryCodeInvalid`
- `jskit.auth.validation.recoveryTokenHashInvalid`
- `jskit.auth.validation.recoveryTypeUnsupported`
- `jskit.auth.denied.notAllowlistedDefault`
- `jskit.auth.denied.blockedDefault`
- `jskit.auth.denied.unspecified`

</details>

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".
- Every auth error has a dotted code (for example `auth.login.invalidCredentials`); the former `AUTH_POLICY_ERROR` sites have their own codes.
- `createAuthPolicyError(status, message, { code, params })`; OAuth redirects add `error_code` and `error_params`.

### New message keys (26)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.auth.session.required`
- `jskit.auth.session.unavailable`
- `jskit.auth.login.invalidCredentials`
- `jskit.auth.policy.ownerUnresolved`
- `jskit.auth.policy.ownerMismatch`
- `jskit.auth.policy.invalidConfiguration`
- `jskit.auth.policy.permissionDenied`
- `jskit.auth.dev.unavailable`
- `jskit.auth.dev.secretMissing`
- `jskit.auth.dev.localhostOnly`
- `jskit.auth.dev.exchangeUnauthorized`
- `jskit.auth.dev.userRequired`
- `jskit.auth.dev.userNotFound`
- `jskit.auth.operation.unsupported`
- `jskit.auth.validation.emailRequired`
- `jskit.auth.validation.emailInvalid`
- `jskit.auth.validation.passwordRequired`
- `jskit.auth.validation.passwordLength`
- `jskit.auth.validation.passwordTooLong`
- `jskit.auth.validation.confirmPasswordRequired`
- `jskit.auth.validation.passwordsMismatch`
- `jskit.auth.profile.displayNameRequired`
- `jskit.auth.recovery.tokenRequired`
- `jskit.auth.password.updatedSignIn`
- `jskit.auth.denied.notAllowlisted`
- `jskit.auth.denied.blocked`

</details>

### Codes (26)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `auth.session.required` | Authentication required. |
| `auth.session.unavailable` | Authentication service temporarily unavailable. Please retry. |
| `auth.login.invalidCredentials` | Invalid email or password. |
| `auth.policy.ownerUnresolved` | Route owner could not be resolved. |
| `auth.policy.ownerMismatch` | Forbidden. |
| `auth.policy.invalidConfiguration` | Invalid route auth policy configuration. |
| `auth.policy.permissionDenied` | Forbidden. |
| `auth.dev.unavailable` | Not found. |
| `auth.dev.secretMissing` | AUTH_DEV_BYPASS_SECRET is required when AUTH_DEV_BYPASS_ENABLED=true. |
| `auth.dev.localhostOnly` | Dev auth bootstrap is only available from localhost. |
| `auth.dev.exchangeUnauthorized` | Dev auth exchange is not authorized. |
| `auth.dev.userRequired` | Provide a user id or email. |
| `auth.dev.userNotFound` | User not found. |
| `auth.operation.unsupported` | Auth operation "{operation}" is not supported by the active provider. |
| `auth.validation.emailRequired` | Email is required. |
| `auth.validation.emailInvalid` | Provide a valid email address. |
| `auth.validation.passwordRequired` | Password is required. |
| `auth.validation.passwordLength` | Password must be between {min} and {max} characters. |
| `auth.validation.passwordTooLong` | Password must be at most {max} characters. |
| `auth.validation.confirmPasswordRequired` | Confirm your password. |
| `auth.validation.passwordsMismatch` | Passwords do not match. |
| `auth.profile.displayNameRequired` | Display name is required. |
| `auth.recovery.tokenRequired` | Recovery token is required. |
| `auth.password.updatedSignIn` | Password updated. Sign in with your new password. |
| `auth.denied.notAllowlisted` | Sign-in succeeded, but this account is not allowed to access this application. |
| `auth.denied.blocked` | Sign-in succeeded, but this account has been blocked from accessing this application. |
