# Changelog

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".

### New message keys (49)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.auth.supabase.config.missing`
- `jskit.auth.supabase.config.passwordSettingsMissing`
- `jskit.auth.supabase.request.failed`
- `jskit.auth.supabase.register.emailTaken`
- `jskit.auth.supabase.register.noUser`
- `jskit.auth.supabase.register.confirmationSent`
- `jskit.auth.supabase.login.rateLimited`
- `jskit.auth.supabase.login.emailUnconfirmed`
- `jskit.auth.supabase.otp.sent`
- `jskit.auth.supabase.otp.codeRequired`
- `jskit.auth.supabase.otp.invalid`
- `jskit.auth.supabase.oauth.disabled`
- `jskit.auth.supabase.oauth.providerInvalid`
- `jskit.auth.supabase.oauth.cancelled`
- `jskit.auth.supabase.oauth.failed`
- `jskit.auth.supabase.oauth.codeRequired`
- `jskit.auth.supabase.tokens.accessTokenRequired`
- `jskit.auth.supabase.tokens.refreshTokenRequired`
- `jskit.auth.supabase.token.subjectMissing`
- `jskit.auth.supabase.token.emailMissing`
- `jskit.auth.supabase.recovery.requested`
- `jskit.auth.supabase.recovery.rateLimited`
- `jskit.auth.supabase.recovery.linkInvalid`
- `jskit.auth.supabase.password.sameAsCurrent`
- `jskit.auth.supabase.password.updateFailed`
- `jskit.auth.supabase.password.currentIncorrect`
- `jskit.auth.supabase.password.currentUnverified`
- `jskit.auth.supabase.password.signInDisabled`
- `jskit.auth.supabase.session.emailUnresolved`
- `jskit.auth.supabase.methods.lastEnabled`
- `jskit.auth.supabase.methods.enabledNotBoolean`
- `jskit.auth.supabase.methods.passwordUnresolved`
- `jskit.auth.supabase.methods.passwordNotSet`
- `jskit.auth.supabase.link.alreadyLinked`
- `jskit.auth.supabase.link.manualLinkingDisabled`
- `jskit.auth.supabase.link.lastIdentity`
- `jskit.auth.supabase.link.notLinked`
- `jskit.auth.supabase.link.unsupported`
- `jskit.auth.supabase.unlink.unsupported`
- `jskit.auth.supabase.unlink.notLinked`
- `jskit.auth.supabase.unlink.identityUnresolved`
- `jskit.auth.supabase.profile.invalid`
- `jskit.auth.supabase.profile.updateFailed`
- `jskit.auth.supabase.profile.syncFailed`
- `jskit.auth.supabase.profile.emailConflict`
- `jskit.auth.supabase.profile.payloadIncomplete`
- `jskit.auth.supabase.dev.sessionInvalid`
- `jskit.auth.supabase.dev.findByIdMissing`
- `jskit.auth.supabase.dev.findByEmailMissing`

</details>

### Codes (49)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `auth.supabase.config.missing` | Auth provider is not configured. |
| `auth.supabase.config.passwordSettingsMissing` | Password sign-in settings repository is not configured. |
| `auth.supabase.request.failed` | Authentication request could not be processed. |
| `auth.supabase.register.emailTaken` | Email is already registered. |
| `auth.supabase.register.noUser` | Supabase sign-up did not return a user. |
| `auth.supabase.register.confirmationSent` | If an account exists for that email, a confirmation email has been sent. |
| `auth.supabase.login.rateLimited` | Too many authentication attempts. Please wait and try again. |
| `auth.supabase.login.emailUnconfirmed` | Account exists but email confirmation is required before login. |
| `auth.supabase.otp.sent` | If an account exists for that email, a one-time code has been sent. |
| `auth.supabase.otp.codeRequired` | One-time code is required. |
| `auth.supabase.otp.invalid` | One-time code is invalid or expired. |
| `auth.supabase.oauth.disabled` | OAuth sign-in is not enabled. |
| `auth.supabase.oauth.providerInvalid` | OAuth provider must be one of: {providers}. |
| `auth.supabase.oauth.cancelled` | OAuth sign-in was cancelled. |
| `auth.supabase.oauth.failed` | OAuth sign-in failed. |
| `auth.supabase.oauth.codeRequired` | OAuth code is required when access/refresh tokens are not provided. |
| `auth.supabase.tokens.accessTokenRequired` | Access token is required when a refresh token is provided. |
| `auth.supabase.tokens.refreshTokenRequired` | Refresh token is required when an access token is provided. |
| `auth.supabase.token.subjectMissing` | Token is missing subject claim. |
| `auth.supabase.token.emailMissing` | Token is missing email claim. |
| `auth.supabase.recovery.requested` | If an account exists for that email, a password reset link has been sent. |
| `auth.supabase.recovery.rateLimited` | Too many recovery attempts. Please wait and try again. |
| `auth.supabase.recovery.linkInvalid` | Recovery link is invalid or has expired. |
| `auth.supabase.password.sameAsCurrent` | New password must be different from the current password. |
| `auth.supabase.password.updateFailed` | Unable to update password with the provided value. |
| `auth.supabase.password.currentIncorrect` | Current password is incorrect. |
| `auth.supabase.password.currentUnverified` | Unable to verify current password. |
| `auth.supabase.password.signInDisabled` | Password sign-in is disabled for this account. |
| `auth.supabase.session.emailUnresolved` | Authenticated user email could not be resolved. |
| `auth.supabase.methods.lastEnabled` | At least one sign-in method must remain enabled. |
| `auth.supabase.methods.enabledNotBoolean` | Enabled must be a boolean. |
| `auth.supabase.methods.passwordUnresolved` | Password method configuration could not be resolved. |
| `auth.supabase.methods.passwordNotSet` | Set a password before enabling password sign-in. |
| `auth.supabase.link.alreadyLinked` | This sign-in method is already linked. |
| `auth.supabase.link.manualLinkingDisabled` | Provider linking is disabled in Supabase. Enable Manual Linking in Supabase Auth settings to link or unlink providers. |
| `auth.supabase.link.lastIdentity` | At least one linked sign-in method must remain available. |
| `auth.supabase.link.notLinked` | This sign-in method is not currently linked. |
| `auth.supabase.link.unsupported` | Supabase client does not support identity linking in this environment. |
| `auth.supabase.unlink.unsupported` | Supabase client does not support identity unlinking in this environment. |
| `auth.supabase.unlink.notLinked` | {provider} is not linked to this account. |
| `auth.supabase.unlink.identityUnresolved` | Linked identity details could not be resolved for this provider. |
| `auth.supabase.profile.invalid` | {context} is invalid. |
| `auth.supabase.profile.updateFailed` | Unable to update profile details. |
| `auth.supabase.profile.syncFailed` | Authentication profile synchronization failed. Please retry. |
| `auth.supabase.profile.emailConflict` | This email is already registered with another sign-in method. Sign in with that method, then link this provider in Settings > Security. |
| `auth.supabase.profile.payloadIncomplete` | Auth provider user payload is missing required fields. |
| `auth.supabase.dev.sessionInvalid` | Dev session is invalid. |
| `auth.supabase.dev.findByIdMissing` | Dev auth bootstrap requires internal.repository.user-profiles.findById(). |
| `auth.supabase.dev.findByEmailMissing` | Dev auth bootstrap requires internal.repository.user-profiles.findByEmail() for email lookup. |
