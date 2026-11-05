# Changelog

## Unreleased

- The settings, security and avatar field messages are sent in the coded form `{ code, message, params }`, so their field errors translate. The English is unchanged.
- The resources' validation feedback names the catalog key `jskit.users.feedback.validationFailed` instead of plain English; JSKIT's forms render it with `text()`, so the English shown is unchanged.
- `USER_PROFILE_EMAIL_CONFLICT` has its English in the catalog, so it translates.

### New codes (17)

<details><summary>Code list</summary>

- `USER_PROFILE_EMAIL_CONFLICT`
- `users.avatar.streamMissing`
- `users.avatar.mimeTypeInvalid`
- `users.avatar.fileNameInvalid`
- `users.avatar.uploadDimensionInvalid`
- `users.security.currentPasswordInvalid`
- `users.security.newPasswordRequired`
- `users.security.newPasswordMinLength`
- `users.security.confirmPasswordRequired`
- `users.security.enabledRequired`
- `users.security.enabledInvalid`
- `users.security.oauthProviderRequired`
- `users.security.oauthProviderInvalid`
- `users.security.returnToInvalid`
- `users.settings.productUpdatesInvalid`
- `users.settings.accountActivityInvalid`
- `users.settings.securityAlertsInvalid`

</details>

### New message keys (18)

<details><summary>Key list</summary>

- `jskit.errors.USER_PROFILE_EMAIL_CONFLICT`
- `jskit.users.avatar.streamMissing`
- `jskit.users.avatar.mimeTypeInvalid`
- `jskit.users.avatar.fileNameInvalid`
- `jskit.users.avatar.uploadDimensionInvalid`
- `jskit.users.security.currentPasswordInvalid`
- `jskit.users.security.newPasswordRequired`
- `jskit.users.security.newPasswordMinLength`
- `jskit.users.security.confirmPasswordRequired`
- `jskit.users.security.enabledRequired`
- `jskit.users.security.enabledInvalid`
- `jskit.users.security.oauthProviderRequired`
- `jskit.users.security.oauthProviderInvalid`
- `jskit.users.security.returnToInvalid`
- `jskit.users.feedback.validationFailed`
- `jskit.users.settings.productUpdatesInvalid`
- `jskit.users.settings.accountActivityInvalid`
- `jskit.users.settings.securityAlertsInvalid`

</details>

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".
- Saved locales are canonical BCP 47 codes (`en-AU`); the language list comes from `config.languages` when the app sets it. Exports `./shared/settings`.

### Upgrading

- Success responses that had `meta.message` also carry `meta.messageCode` and `meta.messageParams`.

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
