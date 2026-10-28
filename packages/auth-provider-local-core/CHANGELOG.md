# Changelog

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".

### New message keys (9)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.auth.local.email.invalid`
- `jskit.auth.local.password.tooShort`
- `jskit.auth.local.password.currentInvalid`
- `jskit.auth.local.password.changed`
- `jskit.auth.local.register.emailTaken`
- `jskit.auth.local.recovery.notConfigured`
- `jskit.auth.local.recovery.requested`
- `jskit.auth.local.recovery.tokenInvalid`
- `jskit.auth.local.recovery.sessionRequired`

</details>

### Codes (9)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `auth.local.email.invalid` | Enter a valid email address. |
| `auth.local.password.tooShort` | Password must be at least {min} characters. |
| `auth.local.password.currentInvalid` | Current password is invalid. |
| `auth.local.password.changed` | Password updated. |
| `auth.local.register.emailTaken` | An account already exists for this email. |
| `auth.local.recovery.notConfigured` | Password recovery is not configured. |
| `auth.local.recovery.requested` | If an account exists for that email, password reset instructions have been sent. |
| `auth.local.recovery.tokenInvalid` | Recovery token is invalid or expired. |
| `auth.local.recovery.sessionRequired` | Recovery session required. |
