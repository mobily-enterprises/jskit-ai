# Changelog

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".
- Saved locales are canonical BCP 47 codes (`en-AU`); the language list comes from `config.languages` when the app sets it. Exports `./shared/settings`.

### New message keys (11)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.users.profile.notFound`
- `jskit.users.avatar.notFound`
- `jskit.users.avatar.uploadResultMissing`
- `jskit.users.security.passwordChangeUnavailable`
- `jskit.users.security.passwordMethodToggleUnavailable`
- `jskit.users.security.oauthLinkUnavailable`
- `jskit.users.security.oauthUnlinkUnavailable`
- `jskit.users.security.logoutOtherSessionsUnavailable`
- `jskit.users.security.passwordConfirmationMismatch`
- `jskit.users.security.passwordUpdated`
- `jskit.users.bootstrap.authUnavailable`

</details>

### Codes (11)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `users.profile.notFound` | User profile was not found. |
| `users.avatar.notFound` | Avatar not found. |
| `users.avatar.uploadResultMissing` | Avatar upload completed without a profile result. |
| `users.security.passwordChangeUnavailable` | Password change is not available. |
| `users.security.passwordMethodToggleUnavailable` | Password method toggle is not available. |
| `users.security.oauthLinkUnavailable` | OAuth linking is not available. |
| `users.security.oauthUnlinkUnavailable` | OAuth unlink is not available. |
| `users.security.logoutOtherSessionsUnavailable` | Logout other sessions is not available. |
| `users.security.passwordConfirmationMismatch` | Password confirmation does not match. |
| `users.security.passwordUpdated` | Password updated. |
| `users.bootstrap.authUnavailable` | Authentication service temporarily unavailable. Please retry. |
