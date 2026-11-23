# Changelog

## Unreleased

- A page whose own query names `state` or `type` (or another param a sign-in callback brings, such as `token_type`) keeps it. The auth guard sent any page carrying one of sixteen callback param names to `/auth/login` as a callback, which returned to the page without them: reloading `/console/builds?app=X&state=all&tab=queues` came back as `/console/builds?app=X&tab=queues`. It now sends a page on only when it carries a callback the sign-in page completes, an authorization `code`, an `access_token` and `refresh_token` pair, or an `error` (or `errorCode`), by the one rule (`isOAuthCallback` in `authCallbackUrlParams.js`) by which `readOAuthCallbackParamsFromUrl` answers; such callbacks go on as before. The guard and the sign-in page strip one list of callback params, so the way back of a page sent on now also drops `iss` and `error_params`, and the address the sign-in page leaves after completing a callback also drops `token_hash`. A `token_hash` alone, which the sign-in page never completed, no longer sends a page on.
- A provider sign-in keeps its way back: `DefaultLoginView` keeps `{ provider, returnTo, invitationToken }` in the starting tab's session storage and reads it on the callback, so after a Cancel at the provider, or a failed sign-in, the page still returns to the page asked for and keeps the invitation (a provider returns to the one fixed `/auth/login` with neither, and the page fell back to `/`). Starting from an invitation sends its `invitationToken` to the provider's start. Storage the browser refuses leaves sign-in as it was.
- Completing a provider sign-in (`POST /api/oauth/complete` and the session read after it) is limited to 20 seconds. A provider or network that never answered left the sign-in page loading for ever; now the page stops it, says "Signing in with the provider took too long, so it was stopped. Try again." (`jskit.auth.login.error.oauthCompleteTimedOut`) and offers **Try again with** that provider, to the same page. `completeOAuthCallbackFromUrl` takes `timeoutMs` and answers `timedOut` and `provider`; the completion request carries an abort signal.
- A sign-in link that names an address (`/auth/login?email=...`, as an invitation's sign-in names the invited one) shows that address even where the browser remembers another account: the remembered account is not offered on that visit and stays remembered for the next. Before, it replaced the address, so an invited person who chose **Use a different account** was handed back the account they had just left. A value that is no email address, or the remembered account's own, changes nothing.
- A paused password sign-in (429 `auth.local.login.locked`) shows the wait and the other ways forward the app offers beside it: **Reset your password** where password recovery is set up, **Create an account** where registration is open to the visitor, and a pointer to the provider buttons where providers exist (`jskit.auth.login.signInPaused.*`).
- `DefaultLoginView` takes `fallbackReturnTo` (default `/`, so an app that does not set it is unchanged): where a sign-in lands when the address names no `returnTo`, or one refused as on another origin or as `/auth/login` or `/auth/signout`, and the fallback of the main-screen link and of a provider's callback. An app whose `/` is not its app, such as a static website its server serves, names its landing there. Sign-out without a `returnTo` now opens sign-in without one (it sent `?returnTo=/`), so that landing applies after it; a sign-out with a `returnTo` still passes it on.
- A browser the shell found signed in at boot no longer sees the sign-in form for the moment the page takes to check the session again and send it on: the card is not rendered while the boot session says signed in, and appears if that check finds the session gone. A confirmation link or a provider's callback still shows its own state, and a signed-out visitor sees the form at once. The card is also hidden while a session started elsewhere sends the page on.
- Up to medium width, the account control's name begins with the initials its avatar shows: "AN ana.ferreira" for ana.ferreira without a picture, the person's name alone with one. That round button is named by its aria-label, and WCAG 2.5.3 Label in Name asks that a control's name hold the text it shows, the words a person using speech input says to press it (axe `label-content-name-mismatch`). Its avatar is hidden from assistive technology (`aria-hidden="true"`), since the name says whose account it is; hiding it alone, as 0.2.45 did, left the finding, as axe counts every word drawn on the screen. On wider windows the control's name is the text it shows, as before.
- Email change over HTTP: `POST /api/email-change` (signed in, `{ email, password }`) asks for it and `POST /api/email-change/confirm` (public, `{ token }`) uses the link, each limited per address by `config.auth.rateLimits.emailChange` (5 a minute) and `emailChangeConfirm` (10 a minute). The page the link opens is `DefaultEmailChangeView` (`./client/views/DefaultEmailChangeView`, route component `auth-email-change`, the `auth.email-change` route at `/auth/email-change`, public, registered by an application's own page as the sign-in, reset and sign-out pages are): it confirms the link once, takes the token out of the address, and says the new email or why the link was refused (`jskit.auth.emailChange.*`).
- `POST /api/login/pass` hands `signInWithPass` the request that posted the pass, so local auth keeps the session's address and browser.
- Its tests name `APP_ENV`, which the auth providers now read in place of `NODE_ENV`; the setup-code field is asked for by a staging or production server.
- `POST /api/login/pass` reads its settings with `resolvePassSignInFromEnv` from `@jskit-ai/auth-pass/server`, a new dependency, instead of auth-core's removed `./server/passSignIn`. The route behaves as before.

- `POST /api/login/pass`, registered only while `AUTH_PASS_PUBLIC_KEY` is set: an issuer's page posts a one-time pass as the form field `pass`, and a pass that signs in sets the session cookies and answers 303 to `/`; a refused one answers 303 to `/auth/login` with `error=sign_in_unavailable`, `error_description` and `error_code`, which the sign-in page shows. It takes form bodies in a Fastify scope of its own, registered at boot, so the feature now requires `runtime.fastify`; it is public, takes no CSRF token (the pass authenticates it) and answers `Cache-Control: no-store`. Its rate limit is `config.auth.rateLimits.passSignIn` (20 a minute per address); one that no route limiter would enforce stops startup.
- The package manifest no longer requires `runtime.actions`: its feature declares no actions, so since the kernel's 9646ecf21 it does not require the action catalogue, and the catalog's manifest check reported the requirement as one no server provider has.
- `SecondFactorSettings` emits `codes-saved` when the person says they saved a new set of recovery codes (after setting an authenticator up, or replacing its codes), so a page that needs an authenticator before it goes on, such as a console's way in, goes on then; and its recovery codes step has **Download codes** beside **Copy codes**, which saves them as `recovery-codes.txt`, one a line (new message key `jskit.auth.secondFactor.codes.download`). `SecondFactorDialog` gives focus back to the element that had it when it opened, the control that sent the refused request, after the code as after a cancel: the dialog opens for a request and has no activator, so focus used to fall to the page's body.
- **Second factor.** The routes `GET /api/second-factor`, `POST /api/second-factor/setup`, `/setup/confirm`, `/verify` and `/recovery-codes`, and `DELETE /api/second-factor` run the `auth.secondFactor.*` actions for the signed-in session, each with its own per-address limit in `AUTH_RATE_LIMITS` (`secondFactorSetup`, `secondFactorSetupConfirm` and `secondFactorVerify` 10 a minute, `secondFactorRecoveryCodes` and `secondFactorRemove` 5 a minute).
- Client: `SecondFactorSettings` sets an authenticator app up (its QR code and key, then a first code), shows the recovery codes once, replaces them and removes the authenticator with a code or a recovery code, for an account settings section; `SecondFactorPrompt` proves the session's second factor; `SecondFactorDialog` with `useSecondFactorStepUp()` runs a request again after the person proves it, when its route refused it with `auth.secondFactor.required` (`run(request)`, binding `open`, `verified` and `cancel` to the dialog). A refused code shows beside its field; other failures go to the shell's snackbar. The three views come from their own paths (`@jskit-ai/auth-web/client/views/SecondFactorSettings`, `.../SecondFactorPrompt`, `.../SecondFactorDialog`), not `@jskit-ai/auth-web/client`, so only a page that shows one loads it; `useSecondFactorStepUp` comes from `@jskit-ai/auth-web/client`. New dependency `uqr` (MIT) draws the QR code, on the settings page alone. New message keys under `jskit.auth.secondFactor` (an app with other locales adds them with `npx jskit i18n export <locale>`).
- The sign-in screen's action rows wrap: on a phone, "Confirm your email"'s three actions (go to the main screen, resend the confirmation email, back to sign in) reflow onto a second line inside the card, as Material 3 reflows actions that do not fit, where the row clipped its last button at 390px. The reset and one-time-code rows and the forgot-password links wrap the same way, keeping their 12px gap.
- The sign-in, registration and reset-password fields have no margin under them, since each keeps its supporting-text line (`@jskit-ai/material-web` no longer sets `hideDetails: "auto"`): an email or password error shown on blur appears in place instead of pushing the form down.
- `loginRequestAsExistingUser(request, options)` (new, `@jskit-ai/auth-web/test/playwright`) signs a Playwright APIRequestContext in, as `loginAsExistingUser()` signs a page's context in: a browser test `signIn` module uses it to sign each worker in once.
- `loginAsExistingUser(page, { email | userId, secret })` from `@jskit-ai/auth-web/test/playwright` signs in on the test's own server: with no `baseURL`, its requests go to the page context's `baseURL`, so each Playwright worker signs in on its own server (`browserTestConfig()`), instead of `PLAYWRIGHT_BASE_URL` or `127.0.0.1:${PLAYWRIGHT_PORT || 4173}`, which sent every worker's sign-in to the first worker's server. The dev-auth secret still goes only to a local server: the one a given `baseURL` names, or the one that answered the session request; a managed `PLAYWRIGHT_BASE_URL` is still refused before any request.
- The `auth/auth-surface` pattern shows the app's identity on its sign-in, reset and sign-out screens: its pages render the app's view wrappers (`src/views/auth/LoginView.vue`, `ResetPasswordView.vue`, `SignOutView.vue`) instead of the default views, and each wrapper fills the `brand` slot with the new `src/components/AppBrand.vue`, the app's name as `index.html`'s `<title>` spells it (a `text-title-large` wordmark in the wide pane, a `text-title-medium` row on phones, no heading). The foundations' rename step renames it with the `<title>`. Upgrading: an app whose `src/pages/auth/*.vue` render the default views directly makes them render its wrappers, and gives the wrappers its brand.
- The app bar's account control is the avatar alone, a round icon button named by its `aria-label`, on compact and medium windows (below 840dp), so a long name no longer squeezes the bar's title to "Setti…" beside its actions; on expanded windows the name beside the avatar ends in an ellipsis past 12rem. It reads the shell's window size classes (`useShellWindowSizeClass()`).
- Sign in and Register are a Material 3 segmented button (`role="radiogroup"`, labelled by the new message key `jskit.auth.login.mode.label`, "Sign in or register"): one `outline`, two equal segments, the selected one on `secondary-container` with a check. It shows only when both are offered; an app or a remembered account with Sign in alone shows no switcher. Register no longer ends with "Already have an account? Back to sign in", which repeated the Sign in segment, so the message key `jskit.auth.login.hasAccount` is gone.
- The profile menu's activator is a round icon button around the avatar on phones, where the name is hidden, so its state layer is a circle; beside the name, on wider windows, it stays a pill.
- `DefaultLoginView`, `DefaultResetPasswordView` and `DefaultSignOutView` take a `brand` slot that JSKIT lays out: a pane beside the card on wide windows (`primary-container`) and a compact row above the card on phones, the slot given `{ compact }`. The three share one screen, so the sign-out screen is the whole screen on phones too, and the three cards have one container treatment: a flat `surface-container-low` card on the screen's `surface-container`, with no shadow or outline over it (the reset card's border is gone too). Upgrading: an app that framed the views and overrode `.login-screen`, `.reset-screen` or `.signout-main` moves its brand into the slot and drops those rules.
- Sign-in has its one `h1`, "Sign in" (new message key `jskit.auth.login.title.login`; an app with other locales adds it with `npx jskit i18n export <locale>`), as every other mode and screen has; the reset and sign-out titles use the same `text-headline-medium` role.
- The Register tab shows only when the provider lets anyone register (`features.password.selfRegister`), or for an invited person (an `invitationToken` in the address), so an app with `AUTH_LOCAL_SELF_REGISTRATION=false` offers no form that would be refused.
- While the app has no account (`features.firstAccountSetupCode`), the registration form explains that the first account becomes the owner and asks for the setup code from the server's log or its hosting service, and sends it as `setupCode`. New message keys: `jskit.auth.login.firstAccount.explain` and `jskit.auth.login.field.setupCode`.
- Email confirmation on the sign-in page: "Confirm your email" has a field for the emailed link or its code, and in development, when the registration's answer carries the link, shows it with a button that confirms it. Confirming sends the registration's password with the code, from the field "Password you registered with", which keeps the password just typed to register or sign in. Opening the emailed link (`/auth/login?confirmation_token=...`) takes the code out of the address and asks for that password ("Enter your password to finish confirming your email.") before it confirms, so a link opened alone creates nothing; a wrong password shows the provider's refusal and keeps the form. Confirming signs the person in and opens the requested page. A sign-in refused with `auth.login.emailUnconfirmed` opens "Confirm your email" instead of an error. New route `POST /api/register/confirm`, which writes the new session's cookies, limited by `config.auth.rateLimits.registerConfirm` (10 a minute); the register answer carries `confirmationUrl` when the provider gives it. New message keys: `jskit.auth.register.confirmed`, `jskit.auth.login.field.confirmationCode`, `jskit.auth.login.confirmEmail.confirm`, `.devLink`, `.useDevLink`, `.passwordHint`, `.linkOpened`, `jskit.auth.login.field.registrationPassword`, `jskit.auth.login.subtitle.confirmEmailPassword` and `jskit.auth.login.error.confirmRegistrationFailed`.
- The auth routes' rate limits apply, per client address: `login`, `register`, `loginOtpRequest` and `loginOtpVerify` 10 a minute; `registerConfirmationResend` and `passwordForgot` 5; `oauthStart`, `oauthComplete`, `passwordRecovery` and `passwordReset` 20; `devLoginAs` 30. A refused request answers 429 with `kernel.http.rateLimited` and `Retry-After`, and the login page shows it.
- `config.auth.rateLimits.<route>` changes a route's limit (`{ max, timeWindow }`, merged over the default) or removes it (`false`); an unknown route name or a malformed value stops startup. `AuthWebFeature` therefore requires `runtime.config`, which every installed runtime provides.
- The sign-in and sign-out screens use Material 3 colour roles and type: an elevated card on `surface-container` (the whole screen on phones), the selected sign-in mode on `secondary-container`, and the remembered-account and email-confirmation notes on `secondary-container`, without the tinted gradient and borders. The profile menu's button is Material 3's 40dp text button inside material-web's 48dp touch target instead of a fixed 48px height.
- Icons are Material Symbols `$aliases` (from `@jskit-ai/material-web`) instead of `@mdi/js` paths, and text uses Vuetify 4's Material 3 type classes (`text-body-large`, `text-title-medium`, ...) instead of Material 2 ones, which Vuetify 4 no longer styles. Upgrading: see the guide's [Move an app to the Material 3 defaults](https://mobily-enterprises.github.io/jskit-ai/guide/app-setup/material-3-migration).

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".
- Sign-in, registration, password reset, sign-out, OAuth and the profile menu are translated.

### New message keys (80)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.auth.register.confirmEmail`
- `jskit.auth.login.title.register`
- `jskit.auth.login.title.forgot`
- `jskit.auth.login.title.otp`
- `jskit.auth.login.title.confirmEmail`
- `jskit.auth.login.subtitle.register`
- `jskit.auth.login.subtitle.forgot`
- `jskit.auth.login.subtitle.otp`
- `jskit.auth.login.subtitle.confirmEmailSentTo`
- `jskit.auth.login.subtitle.confirmEmailInbox`
- `jskit.auth.login.submit.login`
- `jskit.auth.login.submit.register`
- `jskit.auth.login.submit.forgot`
- `jskit.auth.login.submit.otp`
- `jskit.auth.login.submit.confirmEmail`
- `jskit.auth.login.mode.signIn`
- `jskit.auth.login.mode.register`
- `jskit.auth.login.field.email`
- `jskit.auth.login.field.password`
- `jskit.auth.login.field.confirmPassword`
- `jskit.auth.login.field.otpCode`
- `jskit.auth.login.confirmEmail.message`
- `jskit.auth.login.confirmEmail.goToMainScreen`
- `jskit.auth.login.confirmEmail.resend`
- `jskit.auth.login.confirmEmail.resent`
- `jskit.auth.login.rememberedAccount.welcomeBack`
- `jskit.auth.login.rememberedAccount.fallbackName`
- `jskit.auth.login.rememberedAccount.defaultName`
- `jskit.auth.login.rememberedAccount.switch`
- `jskit.auth.login.rememberedAccount.rememberDevice`
- `jskit.auth.login.oauth.register`
- `jskit.auth.login.oauth.continue`
- `jskit.auth.login.oauth.continueAs`
- `jskit.auth.login.oauth.providerFallback`
- `jskit.auth.login.forgotPassword`
- `jskit.auth.login.useOtp`
- `jskit.auth.login.sendOtp`
- `jskit.auth.login.backToSignIn`
- `jskit.auth.login.hasAccount`
- `jskit.auth.login.rememberedPassword`
- `jskit.auth.login.otherMethod`
- `jskit.auth.login.passwordsMismatch`
- `jskit.auth.login.resetSent`
- `jskit.auth.login.otpSent`
- `jskit.auth.login.error.sessionNotActive`
- `jskit.auth.login.error.authFailed`
- `jskit.auth.login.error.registerFailed`
- `jskit.auth.login.error.resetRequestFailed`
- `jskit.auth.login.error.otpVerifyFailed`
- `jskit.auth.login.error.signInFailed`
- `jskit.auth.login.error.otpRequestFailed`
- `jskit.auth.login.error.emailRequiredForConfirmation`
- `jskit.auth.login.error.resendConfirmationFailed`
- `jskit.auth.login.error.oauthCompleteFailed`
- `jskit.auth.login.error.oauthProviderInvalid`
- `jskit.auth.login.error.oauthReturnToInvalid`
- `jskit.auth.login.error.oauthStartFailed`
- `jskit.auth.login.error.oauthLaunchUnavailable`
- `jskit.auth.login.error.initializeFailed`
- `jskit.auth.oauth.providerMissing`
- `jskit.auth.oauth.invalidCallback`
- `jskit.auth.oauth.popupBlocked`
- `jskit.auth.resetPassword.title`
- `jskit.auth.resetPassword.done`
- `jskit.auth.resetPassword.newPassword`
- `jskit.auth.resetPassword.confirmPassword`
- `jskit.auth.resetPassword.submit`
- `jskit.auth.resetPassword.backToSignIn`
- `jskit.auth.resetPassword.passwordsMustMatch`
- `jskit.auth.resetPassword.recoveryInvalid`
- `jskit.auth.resetPassword.updateFailed`
- `jskit.auth.signOut.title`
- `jskit.auth.signOut.pending`
- `jskit.auth.signOut.failedTryAgain`
- `jskit.auth.signOut.failed`
- `jskit.auth.signOut.retry`
- `jskit.auth.signOut.goToLogin`
- `jskit.auth.signOut.sessionStillActive`
- `jskit.auth.signOut.serverSessionActive`
- `jskit.auth.profile.guest`

</details>

### Codes (1)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `auth.register.confirmEmail` | Check your email to confirm the account before logging in. |
