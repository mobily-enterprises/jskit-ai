# Changelog

## Unreleased

- `./server` exports `OIDC_ISSUER_INFRASTRUCTURE_TABLES`, the six `oidc_issuer_*` tables the accounts hub keeps outside table resources, for an app test's `expectEveryTableOwned({ infrastructureTables })`.
- Closing the hub waits for the client row writes that follow a sent registration response (removing a rejected or deleted registration's row, renaming an updated one) instead of leaving them running, so they finish before the database closes. An app that closed right after such a response waited about 60 s for the abandoned write's database connection; a write that fails is logged as a warning instead of being dropped silently.
- The hub decides production with the kernel's `isProductionEnv`, the check every JSKIT package now shares; what counts as production is unchanged.
- Translation ready: the hub's refusals, emails and pages are message keys with their English in `locales/en.json` (exported as `./locales/en.json`). With no translations, every text, email and page is unchanged.
- The hub's emails and its sign-out, signed-out and sign-in problem pages render in the person's language: the authorization request's `ui_locales`, then the browser's `Accept-Language`, then English. Translations come from the app's `src/locales/<code>/jskit.json`; pages carry `<html lang>`. See "Languages" in the README.
- `createOidcIssuer` takes `catalogs`, extra English catalogs that reword the hub's texts.
- Hub API refusals keep their `error` code and English `message`, and add `messageCode` and `messageParams` so the hub's pages can show them in the person's language.
- `GET /hub/interaction/:uid/details` answers `locale`, the language the sign-in's pages should show.
- `passwordProblem` also returns `messageCode` and `messageParams`.

### Upgrading

- Needs the `@jskit-ai/kernel` release whose `createServerI18n` returns `resolveLocale`.
- Tests that compare whole hub error bodies exactly: coded refusals now also carry `messageCode` and `messageParams`. Match the fields you need instead.

### New message keys (57)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.accounts.request.failed`
- `jskit.accounts.request.hubPagesOnly`
- `jskit.accounts.request.tooManyAttempts`
- `jskit.accounts.signIn.required`
- `jskit.accounts.signIn.expired`
- `jskit.accounts.signIn.noMatch`
- `jskit.accounts.signIn.emailUnconfirmed`
- `jskit.accounts.app.pending`
- `jskit.accounts.account.emailInvalid`
- `jskit.accounts.account.emailTaken`
- `jskit.accounts.account.displayNameRequired`
- `jskit.accounts.account.confirmLinkExpired`
- `jskit.accounts.password.tooShort`
- `jskit.accounts.password.tooLong`
- `jskit.accounts.password.tooCommon`
- `jskit.accounts.password.currentWrong`
- `jskit.accounts.password.recoveryLinkExpired`
- `jskit.accounts.google.disabled`
- `jskit.accounts.google.connectionExpired`
- `jskit.accounts.google.linkExpired`
- `jskit.accounts.google.taken`
- `jskit.accounts.google.passwordRequired`
- `jskit.accounts.admin.ownerRequired`
- `jskit.accounts.admin.unknownAction`
- `jskit.accounts.admin.appNotFound`
- `jskit.accounts.admin.ownerSelf`
- `jskit.accounts.admin.personNotFound`
- `jskit.accounts.admin.testEmailFailed`
- `jskit.accounts.mail.footer`
- `jskit.accounts.mail.confirm.subject`
- `jskit.accounts.mail.confirm.heading`
- `jskit.accounts.mail.confirm.body`
- `jskit.accounts.mail.confirm.action`
- `jskit.accounts.mail.recovery.subject`
- `jskit.accounts.mail.recovery.heading`
- `jskit.accounts.mail.recovery.body`
- `jskit.accounts.mail.recovery.action`
- `jskit.accounts.mail.googleLink.subject`
- `jskit.accounts.mail.googleLink.heading`
- `jskit.accounts.mail.googleLink.body`
- `jskit.accounts.mail.googleLink.action`
- `jskit.accounts.mail.test.subject`
- `jskit.accounts.mail.test.heading`
- `jskit.accounts.mail.test.body`
- `jskit.accounts.mail.test.action`
- `jskit.accounts.mail.test.footer`
- `jskit.accounts.page.signOut.title`
- `jskit.accounts.page.signOut.heading`
- `jskit.accounts.page.signOut.body`
- `jskit.accounts.page.signOut.confirm`
- `jskit.accounts.page.signOut.stay`
- `jskit.accounts.page.signedOut.title`
- `jskit.accounts.page.signedOut.heading`
- `jskit.accounts.page.signedOut.body`
- `jskit.accounts.page.error.title`
- `jskit.accounts.page.error.heading`
- `jskit.accounts.page.error.body`

</details>

### Codes (28)

Refusals the hub sends: the `error` code they always had, the `messageCode` that names their sentence, and its English.

| Code | messageCode | English |
| --- | --- | --- |
| `confirm_link_expired` | `accounts.account.confirmLinkExpired` | This link has expired or was already used. Send a new one from your account. |
| `display_name_required` | `accounts.account.displayNameRequired` | Enter the name your apps should show. |
| `email_invalid` | `accounts.account.emailInvalid` | Enter a valid email address. |
| `email_taken` | `accounts.account.emailTaken` | This email already has an account. Sign in, or reset its password. |
| `app_not_found` | `accounts.admin.appNotFound` | This app is no longer registered. Refresh the page. |
| `owner_required` | `accounts.admin.ownerRequired` | Only the hub's owner can open this page. |
| `owner_self` | `accounts.admin.ownerSelf` | You cannot turn off your own account. |
| `person_not_found` | `accounts.admin.personNotFound` | This person no longer has an account. Refresh the page. |
| `email_failed` | `accounts.admin.testEmailFailed` | The test email was not sent: {reason} |
| `unknown_action` | `accounts.admin.unknownAction` | That action does not exist. |
| `app_pending` | `accounts.app.pending` | This app is waiting for approval by the hub's owner. |
| `google_connection_expired` | `accounts.google.connectionExpired` | This Google connection has expired. Continue with Google again. |
| `google_disabled` | `accounts.google.disabled` | Continue with Google is not set up on this hub. |
| `google_link_expired` | `accounts.google.linkExpired` | This link has expired or was already used. Continue with Google again. |
| `password_required` | `accounts.google.passwordRequired` | Set a password first, so you can still sign in without Google. |
| `google_taken` | `accounts.google.taken` | This Google account is already connected to another account. |
| `current_password_wrong` | `accounts.password.currentWrong` | Your current password is not right. |
| `recovery_link_expired` | `accounts.password.recoveryLinkExpired` | This link has expired or was already used. Ask for a new one. |
| `password_too_common` | `accounts.password.tooCommon` | That password is too common. Choose one that is harder to guess. |
| `password_too_long` | `accounts.password.tooLong` | Use at most {max} characters. |
| `password_too_short` | `accounts.password.tooShort` | Use at least {min} characters. |
| `hub_failed` | `accounts.request.failed` | Something went wrong. Try again in a moment. |
| `hub_request_required` | `accounts.request.hubPagesOnly` | This request must come from the hub's own pages. |
| `rate_limited` | `accounts.request.tooManyAttempts` | Too many attempts. Wait a little and try again. |
| `email_unconfirmed` | `accounts.signIn.emailUnconfirmed` | Confirm your email to continue: open the link we sent you, then press Continue. |
| `interaction_expired` | `accounts.signIn.expired` | This sign-in has expired. Go back to the app and try again. |
| `sign_in_failed` | `accounts.signIn.noMatch` | That email and password don't match. |
| `sign_in_required` | `accounts.signIn.required` | Sign in to continue. |
