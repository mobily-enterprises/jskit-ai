# Changelog

## Unreleased

- `AUTH_LOCAL_SELF_REGISTRATION=false` closes self-registration: an account registers only by an invitation a feature's invitation context resolver resolves for its email, or as the first account (admitted by its setup code in production); anyone else is refused with 403 `auth.local.register.closed` (new message key `jskit.auth.local.register.closed`). Confirmation guards self-registration, so with it off a production server starts without an `auth.local.confirmation-sender`, and those registrations sign in at once. Upgrading: an invitation-only or admin-created-accounts app that refused to start in production for want of a confirmation sender sets `AUTH_LOCAL_SELF_REGISTRATION=false` (and can drop its own 404 hook on the register routes); the startup refusal now names this way out too. `resolveLocalAuthConfig()` returns `selfRegistration`.
- The first account of a production server needs a one-time setup code. While local auth has no account, each start of a production server makes a new code, writes it in the log (a warning with `firstAccountSetupCode` and `firstAccountSetupCodeFile`) and in `first-account-setup-code` in `AUTH_LOCAL_STORE_DIR` (mode 600), and keeps only its hash; registering without it is refused with 403 `auth.local.setup.codeRequired`, with a wrong one with 403 `auth.local.setup.codeInvalid`, and an OAuth sign-in cannot create that account. Once an account exists the code stops working and its file is deleted. Development needs no code, and servers that already have accounts are unchanged. `getCapabilities()` says `features.firstAccountSetupCode` while it waits. `AuthLocalProvider` checks for an account as it starts, and `createLocalAuthService()` takes the started `firstAccountSetup` (by default it checks on first use). New exports `createFirstAccountSetup` and `SETUP_CODE_FILE`; new message keys `jskit.auth.local.setup.codeRequired` and `jskit.auth.local.setup.codeInvalid`.
- Upgrading: a custom `auth.local.backend` implements `users.hasAny()`.
- A hosting tool may supply the first account's setup code in `AUTH_LOCAL_SETUP_CODE` (production only; at least 20 letters and digits, or startup stops naming the variable) and show it to the operator itself. The server then asks for that code at every start and on every server, writes no `first-account-setup-code` file (it deletes one left behind), and logs only that the code is in `AUTH_LOCAL_SETUP_CODE` (`firstAccountSetupCodeEnv`), never the code. New export `SETUP_CODE_ENV`. The refusal and sign-in texts name the server's log or its hosting service.
- Registration confirms the email address, on by default in every environment; `AUTH_LOCAL_EMAIL_CONFIRMATION=false` turns it off. Registering keeps the registration waiting, with no account, profile or session, and answers `requiresEmailConfirmation: true`; the link's code is random, kept only as a hash, works once, expires after a day and is replaced by registering again or `resendRegisterConfirmation`. `confirmRegistration({ token })` creates the account and signs the person in, and the register hook runs then. Signing in with the right password while the registration waits is refused with 403 `auth.login.emailUnconfirmed`. The optional `auth.local.confirmation-sender` (`({ email, confirmationUrl }) => Promise<void>`, which needs `APP_PUBLIC_URL`) emails the link; in development without one, the link is in the answer's `confirmationUrl` and the log; in production without one, startup stops, naming both ways out. Existing accounts are confirmed. New message keys: `jskit.auth.local.register.confirmationInvalid` and `jskit.auth.local.register.confirmationResent`.
- Upgrading: a production app installs an `auth.local.confirmation-sender` or sets `AUTH_LOCAL_EMAIL_CONFIRMATION=false`. Tests that register and expect a session confirm with `confirmationUrl` or set `AUTH_LOCAL_EMAIL_CONFIRMATION=false`. A custom `auth.local.backend` implements the `registrations` collection (`save`, `findByEmail`, `findByTokenHash`, `delete`, `deleteExpired`); the file backend keeps it in `registrations.passwd`, and `@jskit-ai/auth-provider-local-db-core` in the table `auth_local_registrations`, created by its migration `auth_local_db_protection` (run `npm run db:migrate`). `resolveLocalAuthConfig()` takes `emailConfirmationSender`, and `createLocalAuthService()` requires `confirmationSender`: the installed sender, or `createLoggedConfirmationSender(logger)` when there is none.
- A production server (`NODE_ENV=production`) with `AUTH_LOCAL_RECOVERY_DEV_OUTPUT` set refuses to start and names the setting to remove, instead of quietly ignoring it; production recovery stays email only. Upgrading: remove `AUTH_LOCAL_RECOVERY_DEV_OUTPUT` from production environments.
- Failed sign-ins slow down the account they name, existing or not: after `AUTH_LOCAL_SIGN_IN_FAILURES_BEFORE_WAIT` (5) failures in a row the email waits `AUTH_LOCAL_SIGN_IN_FIRST_WAIT_SECONDS` (30) before its next attempt, and each further failure doubles the wait up to `AUTH_LOCAL_SIGN_IN_MAX_WAIT_SECONDS` (3600). While it waits, sign-in is refused, even with the right password, with status 429, the code `auth.local.login.locked` (`params.count` minutes, `params.retryAfterSeconds`) and `Retry-After`. A successful sign-in or a completed password reset forgets the failures, and so does a day without one, so a wait is never permanent and recovery always lets the owner back in.
- `AUTH_LOCAL_PASSWORD_MIN_LENGTH` (default 8, from 8 to 64) sets the shortest password accepted on registration, reset and change.
- Upgrading: a custom `auth.local.backend` implements the new `signInFailures` collection (`find`, `save`, `clear`, `deleteBefore`); the file backend keeps it in `sign-in-failures.passwd`, and `@jskit-ai/auth-provider-local-db-core` in the table `auth_local_sign_in_failures`, which its migration `auth_local_db_protection` creates (run `npm run db:migrate`). `validatePasswordInput(password, minLength)` takes the minimum length.
- New message key: `jskit.auth.local.login.locked`.

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".

### Upgrading

- Local-account errors now have dotted codes instead of `APP_ERROR` (for example `auth.local.password.currentInvalid`); English and status are unchanged.

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
