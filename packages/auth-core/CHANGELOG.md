# Changelog

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
