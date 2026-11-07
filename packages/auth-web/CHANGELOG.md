# Changelog

## Unreleased

- The `auth/auth-surface` pattern shows the app's identity on its sign-in, reset and sign-out screens: its pages render the app's view wrappers (`src/views/auth/LoginView.vue`, `ResetPasswordView.vue`, `SignOutView.vue`) instead of the default views, and each wrapper fills the `brand` slot with the new `src/components/AppBrand.vue`, the app's name as `index.html`'s `<title>` spells it (a `text-title-large` wordmark in the wide pane, a `text-title-medium` row on phones, no heading). The foundations' rename step renames it with the `<title>`. Upgrading: an app whose `src/pages/auth/*.vue` render the default views directly makes them render its wrappers, and gives the wrappers its brand.
- The app bar's account control is the avatar alone, a round icon button named by its `aria-label`, on compact and medium windows (below 840dp), so a long name no longer squeezes the bar's title to "Setti…" beside its actions; on expanded windows the name beside the avatar ends in an ellipsis past 12rem. It reads the shell's window size classes (`useShellWindowSizeClass()`).
- Sign in and Register are a Material 3 segmented button (`role="radiogroup"`, labelled by the new message key `jskit.auth.login.mode.label`, "Sign in or register"): one `outline`, two equal segments, the selected one on `secondary-container` with a check. It shows only when both are offered; an app or a remembered account with Sign in alone shows no switcher. Register no longer ends with "Already have an account? Back to sign in", which repeated the Sign in segment, so the message key `jskit.auth.login.hasAccount` is gone.
- The profile menu's activator is a round icon button around the avatar on phones, where the name is hidden, so its state layer is a circle; beside the name, on wider windows, it stays a pill.
- `DefaultLoginView`, `DefaultResetPasswordView` and `DefaultSignOutView` take a `brand` slot that JSKIT lays out: a pane beside the card on wide windows (`primary-container`) and a compact row above the card on phones, the slot given `{ compact }`. The three share one screen, so the sign-out screen is the whole screen on phones too, and the three cards have one container treatment: a flat `surface-container-low` card on the screen's `surface-container`, with no shadow or outline over it (the reset card's border is gone too). Upgrading: an app that framed the views and overrode `.login-screen`, `.reset-screen` or `.signout-main` moves its brand into the slot and drops those rules.
- Sign-in has its one `h1`, "Sign in" (new message key `jskit.auth.login.title.login`; an app with other locales adds it with `npx jskit i18n export <locale>`), as every other mode and screen has; the reset and sign-out titles use the same `text-headline-medium` role.
- The Register tab shows only when the provider lets anyone register (`features.password.selfRegister`), or for an invited person (an `invitationToken` in the address), so an app with `AUTH_LOCAL_SELF_REGISTRATION=false` offers no form that would be refused.
- While the app has no account (`features.firstAccountSetupCode`), the registration form explains that the first account becomes the owner and asks for the setup code from the server's log or its hosting service, and sends it as `setupCode`. New message keys: `jskit.auth.login.firstAccount.explain` and `jskit.auth.login.field.setupCode`.
- Email confirmation on the sign-in page: "Confirm your email" has a field for the emailed link or its code, and in development, when the registration's answer carries the link, shows it with a button that confirms it. Opening the emailed link (`/auth/login?confirmation_token=...`) confirms it and takes the code out of the address. Confirming signs the person in and opens the requested page. A sign-in refused with `auth.login.emailUnconfirmed` opens "Confirm your email" instead of an error. New route `POST /api/register/confirm`, which writes the new session's cookies, limited by `config.auth.rateLimits.registerConfirm` (10 a minute); the register answer carries `confirmationUrl` when the provider gives it. New message keys: `jskit.auth.register.confirmed`, `jskit.auth.login.field.confirmationCode`, `jskit.auth.login.confirmEmail.confirm`, `.devLink`, `.useDevLink` and `jskit.auth.login.error.confirmRegistrationFailed`.
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
