# Changelog

## Unreleased

- Email change: `features.emailChange` and three auth.service operations it gates (`AUTH_OPERATION_FEATURES`): `requestEmailChange(request, { email, password })`, the signed-in person's own change; `requestEmailChangeForUser({ userId, email })`, an application's change of an account it chose; and `confirmEmailChange({ token })`, the link sent to the new address. Two actions run them over HTTP and from server code, never automation: `auth.emailChange.request` (signed in) and `auth.emailChange.confirm` (anyone with the link), from `createEmailChangeActions` (`./server/actions/emailChangeActions`), which `AuthFeature` contributes; their commands are `authEmailChangeRequestCommand` and `authEmailChangeConfirmCommand` (`./shared/commands/authEmailChangeCommands`), and their paths `AUTH_PATHS.EMAIL_CHANGE` (`/api/email-change`) and `AUTH_PATHS.EMAIL_CHANGE_CONFIRM` (`/api/email-change/confirm`). Upgrading: every auth provider implements the three operations; one without email change throws `AUTH_OPERATION_UNSUPPORTED`.
- The actions that sign someone in hand `auth.service` the request they came in on: `auth.register`, `auth.register.confirm`, `auth.login.password` and `auth.password.recovery.complete` call `register`, `confirmRegistration`, `login` and `completePasswordRecovery` with `(input, request)`, the request null for an internal call, as `auth.login.oauth.complete` and `auth.dev.loginAs` already did, so a provider can keep where each session was signed in from. `AuthService` documents the optional second parameter; a provider that ignores it is unchanged.
- **Breaking:** dev sign-in, the CSRF cookie's `Secure` and `__Host-` prefix and unknown role grants follow `APP_ENV`, not `NODE_ENV`. `resolveDevAuthPolicy({ enabled, appEnv, secret })` takes the application's `APP_ENV` in place of `nodeEnv` and answers `isDeployed` (staging or production) in place of `isProduction`; a missing or unknown `appEnv` throws. `AUTH_DEV_BYPASS_ENABLED` in staging or production refuses to start with `AUTH_DEV_BYPASS_ENABLED is for development only: remove it from staging and production.` The auth plugin takes `appEnv` in place of `nodeEnv`.
- **Breaking:** `./server/passSignIn` is gone. `signPass`, `verifyPass` and `resolvePassSignInFromEnv` moved unchanged to `@jskit-ai/auth-pass/server`, a package that installs no providers, so an application with its own sign-in can check passes without auth-core's runtime. `AUTH_TEXTS` loses the seven `pass*` entries and `locales/en.json` the `auth.pass.*` texts; they are `PASS_TEXTS` and `createPassError` in auth-pass, whose catalog has the same English. Import from `@jskit-ai/auth-pass/server` instead. `AUTH_PATHS.LOGIN_PASS` and the auth service's `signInWithPass({ pass })` stay here.
- One-time pass sign-in: `./server/passSignIn` exports `signPass` (for the issuer, which holds an Ed25519 private key), `verifyPass` and `resolvePassSignInFromEnv`. A pass is a compact JWS (`alg` EdDSA, `typ` `pass+jwt`) naming one person (`sub`), one application (`aud`), one resource (`resource`) and its id (`jti`), lasting 60 seconds by default and at most five minutes. `AUTH_PASS_PUBLIC_KEY` (PEM, or base64 DER on one line) turns it on, with `AUTH_PASS_AUDIENCE` and `AUTH_PASS_RESOURCE` required. A refused pass is a 401 coded `auth.pass.malformed`, `auth.pass.badSignature`, `auth.pass.wrongAudience`, `auth.pass.wrongResource`, `auth.pass.expired` or `auth.pass.replayed`, or a 403 `auth.pass.unmapped`, each with an English text in `locales/en.json`. `AUTH_PATHS.LOGIN_PASS` is `/api/login/pass`, and the auth service gains the optional `signInWithPass({ pass })`.
- `AUTH_COOKIE_SAME_SITE` sets the CSRF cookie's SameSite: `lax` (the default, unset or blank) or `strict`, as local auth's cookies take it; any other value stops the auth policy's startup with `AUTH_COOKIE_SAME_SITE must be lax or strict, not "<value>".` `./server/utils` exports `resolveAuthCookieSameSite(env)`, which reads it. Applications that leave it unset are unchanged.

- **Second factor.** A route asks for one with the kernel's `secondFactor` option (`true`, or `{ maxAgeSeconds }` for a dangerous action), and the auth policy enforces it: a signed-in session that has not proved its second factor, or proved it longer ago than `maxAgeSeconds`, is refused with 403 `auth.secondFactor.required` (params `{ maxAgeSeconds }` when the route names one), checked after the CSRF token, the sign-in and the route's permission. The policy sets `request.secondFactorAt`, when the session last proved it (`""` when it has not), from the provider's `authenticate` result. `./server/secondFactor` gives `requireSecondFactor(request, requirement)`, the same refusal for an action whose requirement depends on more than its route (the actor's role, say; a call without a request, as from the server's own code, is refused too), with `isSecondFactorMet()` and `secondFactorRequiredParams()`; `./shared/authSecondFactor` gives `SECOND_FACTOR_REQUIRED` and `isSecondFactorRequired(error)` for clients.
- The second factor's actions and commands, each one call to the installed `auth.service` for the request's own session (channels `api` and `internal`, never automation): `auth.secondFactor.read`, `auth.secondFactor.setup.start`, `auth.secondFactor.setup.confirm` (body `{ code }`), `auth.secondFactor.verify`, `auth.secondFactor.recoveryCodes.replace` and `auth.secondFactor.remove` (body `{ code }` or `{ recoveryCode }`), exported from `./server/actions/secondFactorActions` and `./shared/commands`, at `AUTH_PATHS.SECOND_FACTOR`, `SECOND_FACTOR_SETUP`, `SECOND_FACTOR_SETUP_CONFIRM`, `SECOND_FACTOR_VERIFY` and `SECOND_FACTOR_RECOVERY_CODES`. `AuthService` documents the provider operations behind them, plus `listSecondFactors({ userIds })` and `resetSecondFactor({ userId, byUserId })` for an application's own screens (an owner resetting staff who lost their authenticator); a provider without a second factor answers 501 `AUTH_OPERATION_UNSUPPORTED`. The capability `features.secondFactor` says the provider has one, and the security status's `mfa` says whether the account has one set up. New codes: `auth.secondFactor.required`, `auth.validation.secondFactorCodeRequired`; new message keys `jskit.auth.secondFactor.required` and `jskit.auth.validation.secondFactorCodeRequired` (an app with other locales adds them with `npx jskit i18n export <locale>`).
- A route's `permission` now matches the actor's grants as action permissions do: `*` grants every route, and a grant ending in `.*`, such as `crud.labels.*`, grants every permission under that prefix. It used to need the exact name, so a workspace owner holding `*` was refused a route requiring `crud.labels.update`.
- The `AuthInvitationContextResolver` type documents what local auth relies on: the resolver throws for an invitation the registration cannot use, and the context it answers names, in `email`, the address the invitation was sent to and, in `expiresAt`, when it stops working, so a registration through it can skip email confirmation.
- `AuthProfileProjector.syncIdentityProfile` documents `onlyWhenChanged`, which providers pass on an ordinary request so a profile that already matches is only read; sign-in and session refresh synchronize in full.
- `normalizeAuthCapabilities` carries `features.password.selfRegister`: whether anyone may register, not only an invited person or the first account. A provider that doesn't say gets the value of `register`.
- The register body takes `setupCode`, the first account's one-time setup code, and the capability `features.firstAccountSetupCode` says a provider is waiting for it. New message key: `jskit.auth.validation.setupCodeInvalid`.
- Registration confirmation: the action and command `auth.register.confirm` (`POST /api/register/confirm`, body `{ token, password }`, answer `{ ok, email, username, message }` with a message code) confirm a registration's email from the code in its link and the password the registration was made with, so the link alone confirms nothing (a missing password is `auth.validation.passwordRequired`), and `authApi.confirmRegistration()` calls it. `AuthService.confirmRegistration({ token, password })` creates the waiting account and its session; a provider without it answers `AUTH_OPERATION_UNSUPPORTED`. The capability `features.emailConfirmationCode` says the provider takes a code that way. The register and resend answers may carry `confirmationUrl`, the link itself in development. New message keys: `jskit.auth.login.emailUnconfirmed` (refused sign-in, status 403) and `jskit.auth.validation.confirmationCodeRequired`.
- The dev auth policy and the CSRF cookie's default decide production with the kernel's `isProductionEnv`, the check every JSKIT package now shares; what counts as production is unchanged. `./server/devAuth` no longer exports `isProductionNodeEnv(nodeEnv)`: call `isProductionEnv(env)` from `@jskit-ai/kernel/server/runtime/runtimeMode` instead.
- The auth policy no longer registers `@fastify/rate-limit`, which it did after the routes existed, so no route limit applied; the kernel now registers it before the routes and enforces each route's `rateLimit`.

- Every auth command's field messages (sign-in, registration, one-time codes, OAuth, password reset and recovery, dev sign-in) are sent in the coded form `{ code, message, params }`, so their field errors translate. The English is unchanged.
- The default access-denied texts carry the messageCodes `auth.denied.notAllowlistedDefault`, `auth.denied.blockedDefault` and `auth.denied.unspecified`; `./shared/authDenied` adds `AUTH_DENIED_DEFAULT_TEXTS` and `AUTH_DENIED_FALLBACK_TEXT` (`{ message, messageCode }`). `AUTH_DENIED_DEFAULT_MESSAGES` and the English are unchanged.

### New codes (22)

<details><summary>Code list</summary>

- `auth.dev.userIdInvalid`
- `auth.dev.userInvalid`
- `auth.validation.unexpectedField`
- `auth.validation.emailAddressInvalid`
- `auth.validation.passwordMinLength`
- `auth.validation.oauthProviderRequired`
- `auth.validation.oauthProviderInvalid`
- `auth.validation.oauthCodeInvalid`
- `auth.validation.oauthStateInvalid`
- `auth.validation.oauthIssuerInvalid`
- `auth.validation.accessTokenInvalid`
- `auth.validation.refreshTokenInvalid`
- `auth.validation.returnToInvalid`
- `auth.validation.otpCodeRequired`
- `auth.validation.otpTokenHashInvalid`
- `auth.validation.otpTypeUnsupported`
- `auth.validation.recoveryCodeInvalid`
- `auth.validation.recoveryTokenHashInvalid`
- `auth.validation.recoveryTypeUnsupported`
- `auth.denied.notAllowlistedDefault`
- `auth.denied.blockedDefault`
- `auth.denied.unspecified`

</details>

### New message keys (22)

<details><summary>Key list</summary>

- `jskit.auth.dev.userIdInvalid`
- `jskit.auth.dev.userInvalid`
- `jskit.auth.validation.unexpectedField`
- `jskit.auth.validation.emailAddressInvalid`
- `jskit.auth.validation.passwordMinLength`
- `jskit.auth.validation.oauthProviderRequired`
- `jskit.auth.validation.oauthProviderInvalid`
- `jskit.auth.validation.oauthCodeInvalid`
- `jskit.auth.validation.oauthStateInvalid`
- `jskit.auth.validation.oauthIssuerInvalid`
- `jskit.auth.validation.accessTokenInvalid`
- `jskit.auth.validation.refreshTokenInvalid`
- `jskit.auth.validation.returnToInvalid`
- `jskit.auth.validation.otpCodeRequired`
- `jskit.auth.validation.otpTokenHashInvalid`
- `jskit.auth.validation.otpTypeUnsupported`
- `jskit.auth.validation.recoveryCodeInvalid`
- `jskit.auth.validation.recoveryTokenHashInvalid`
- `jskit.auth.validation.recoveryTypeUnsupported`
- `jskit.auth.denied.notAllowlistedDefault`
- `jskit.auth.denied.blockedDefault`
- `jskit.auth.denied.unspecified`

</details>

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
