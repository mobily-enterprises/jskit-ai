# Changelog

## Unreleased

- New package: one-time pass sign-in's pass, moved here from `@jskit-ai/auth-core/server/passSignIn` so an application with its own sign-in can check passes without installing auth-core's providers (its auth policy, CSRF and auth actions). `./server` exports `signPass`, `verifyPass` and `resolvePassSignInFromEnv`, unchanged, and `PASS_TEXTS` with `createPassError`, the seven refusals (`auth.pass.malformed`, `badSignature`, `wrongAudience`, `wrongResource`, `expired`, `replayed`, `unmapped`) whose English moved from auth-core's `locales/en.json` to this package's. The package has `jskit` metadata and no runtime providers, so an application installs nothing from it, and its English still reaches the client like every JSKIT package's.
