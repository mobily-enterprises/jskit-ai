# Changelog

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
