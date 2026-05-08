# JSKIT Mobile Roadmap

## Purpose

This roadmap defines a sane path for JSKIT to support mobile while remaining a
server + web app platform.

The key distinction is:

- Stage 1: strong mobile-shell support
- Stage 2: true broad mobile platform

These are not the same commitment.

Stage 1 means:

- the same JSKIT web app runs inside a native shell
- JSKIT still renders web UI
- Capacitor is packaging/integration glue
- Android is the only MVP target

Stage 2 means:

- JSKIT treats mobile as a first-class runtime target
- JSKIT exposes stable mobile capability seams
- multiple native-facing features are intentionally supported
- broader platform promises become real and maintained

Do not blur those two promises.

## Hard Boundary

Always keep these true unless the roadmap is explicitly changed:

- JSKIT remains a server + web UI platform.
- JSKIT mobile support does not mean a native UI abstraction layer.
- JSKIT mobile support does not mean a React Native equivalent.
- JSKIT mobile support does not create a second route system.
- Mobile launch URLs must normalize into normal JSKIT router paths.
- Android-first is the MVP. iOS is later.

## Stage 1: Strong Mobile-Shell Support

### Stage 1 Goal

Package an existing JSKIT web app into an Android shell that:

- serves bundled local web assets in production
- can optionally use a remote dev server in development
- handles deep links into normal JSKIT routes
- supports auth callback return into the app
- can produce a release AAB

### Stage 1 Success Criteria

Before stage 1 is considered complete, one real JSKIT app must:

- launch in an Android shell
- load bundled local assets
- call the remote JSKIT server/API successfully
- complete login through browser-to-app callback
- deep-link into a normal app route
- prove the rewarded-ad flow works inside the Android shell
- build a release AAB

### Stage 1A: Product Boundary and Config Contract

#### TODO

- [x] Lock the product statement:
  - [x] `JSKIT mobile-shell support packages JSKIT web assets into a native Android shell.`
- [x] Explicitly reject:
  - [x] native UI abstraction work
  - [x] multi-platform parity promises
  - [x] offline-first platform work
  - [x] push/notifications in the MVP
- [x] Add a first-class `mobile` section to app config.
- [x] Keep the config intentionally narrow.
- [x] Define the MVP config shape in `config/public.js`:

```js
config.mobile = {
  enabled: true,
  strategy: "capacitor",
  appId: "com.example.app",
  appName: "Example App",
  assetMode: "bundled", // bundled | dev_server
  devServerUrl: "",
  apiBaseUrl: "https://api.example.com",
  auth: {
    callbackPath: "/auth/login",
    customScheme: "exampleapp",
    appLinkDomains: []
  },
  android: {
    packageName: "com.example.app",
    minSdk: 26,
    targetSdk: 35,
    versionCode: 1,
    versionName: "1.0.0"
  }
};
```

- [x] Add helper accessors:
  - [x] `resolveMobileConfig()`
  - [x] `resolveClientAssetMode()`
  - [x] `resolveMobileCallbackUrls()`

### Stage 1B: Core JSKIT Runtime Seams

This is the minimum core work needed to make mobile-shell real without turning
 JSKIT into a broad mobile platform.

#### TODO

- [x] Add a bootstrap seam for incoming app URLs.
- [x] Teach JSKIT to distinguish:
  - [x] web asset origin
  - [x] API origin
  - [x] browser callback URL
  - [x] mobile callback scheme/domain
- [x] Ensure client bootstrap can defer final navigation until session/auth
      hydration is ready.
- [x] Keep `usePaths()` web-path based.
- [x] Do not create a second path language for mobile.
- [x] Add only the target awareness needed to distinguish:
  - [x] normal web build
  - [x] mobile packaged build
  - [x] mobile dev-server build
- [x] Add a normalizer:
  - [x] `normalizeIncomingAppUrl(url, mobileConfig)`
- [x] Add a bootstrap helper:
  - [x] `registerMobileLaunchRouting({ router, mobileConfig, getInitialLaunchUrl, subscribeToLaunchUrls })`
- [x] Add an auth helper:
  - [x] reusable callback completer for normalized `/auth/login` OAuth callback URLs

#### URL Normalization Rules

- [x] Accept custom schemes.
- [x] Preserve query parameters.
- [x] Strip scheme/host where appropriate.
- [x] Reject non-owned schemes/domains.
- [x] Output exactly one canonical router path.
- [x] Map examples like:
  - [x] `exampleapp://auth/login?...` -> `/auth/login?...`
  - [x] `exampleapp://w/foo/workouts/2026-05-07` -> `/w/foo/workouts/2026-05-07`
  - [x] `https://app.example.com/auth/login?...` -> `/auth/login?...`

#### Startup Behavior Rules

- [x] Cold start:
  - [x] receive launch URL
  - [x] normalize it
  - [x] complete auth if needed
  - [x] navigate once
- [x] Warm resume:
  - [x] receive app-open event
  - [x] normalize URL
  - [x] complete auth if needed
  - [x] route idempotently
- [x] Avoid duplicate navigation on startup.

### Stage 1C: `@jskit-ai/mobile-capacitor`

Create one thin integration package.

#### Package Boundary

`@jskit-ai/mobile-capacitor` should own:

- Capacitor scaffolding
- Android shell setup
- sync/run/build commands
- deep-link/bootstrap glue
- mobile-shell docs
- mobile-shell doctor checks

It should not own:

- app-specific auth provider logic
- app-specific route definitions
- billing
- notifications
- product-specific native features

#### TODO

- [x] Create `@jskit-ai/mobile-capacitor`.
- [x] Make it a thin integration package, not a mobile framework.
- [x] Define the actual Stage 1 package layout:

```txt
packages/mobile-capacitor/
  package.descriptor.mjs
  src/
    client/
      index.js
      providers/
        MobileCapacitorClientProvider.js
      runtime/
        globalCapacitorAppAdapter.js
        mobileCapacitorRuntime.js
    server/
      buildTemplateContext.js
  templates/
    capacitor.config.json
    mobile-capacitor.md
```

- [x] Generate repo/app artifacts:
  - [x] `capacitor.config.json`
  - [x] `android/`
  - [x] `.jskit/mobile-capacitor.md`
- [x] Include a manifest/intents template story for custom-scheme deep links.

### Stage 1D: CLI and Build Flow

#### TODO

- [x] Add:
  - [x] `jskit add package @jskit-ai/mobile-capacitor`
  - [x] `jskit mobile android sync`
  - [x] `jskit mobile android run`
  - [x] `jskit mobile android build`
  - [x] `jskit mobile android doctor`

#### `jskit add package @jskit-ai/mobile-capacitor`

- [x] Install:
  - [x] `@capacitor/core`
  - [x] `@capacitor/cli`
  - [x] `@capacitor/android`
- [x] Create `capacitor.config.json`.
- [x] Create `android/`.
- [x] Add `config.mobile` stub if missing.
- [x] Add npm scripts:
  - [x] `mobile:sync:android`
  - [x] `mobile:run:android`
  - [x] `mobile:build:web`
  - [x] `mobile:build:android`
- [x] Boot the mobile runtime through the normal JSKIT client provider path instead of an app-local import hook.
- [x] Add `.jskit/mobile-capacitor.md`.

#### `jskit mobile android sync`

- [x] Run the correct JSKIT frontend build.
- [x] Copy built assets into the Capacitor web dir.
- [x] Run `npx cap sync android`.
- [x] Start with one bundle strategy:
  - [x] bundle the app as a whole
- [ ] Consider selected-surface or all-surface bundle strategies later only if
      the whole-app bundle proves too heavy.

#### `jskit mobile android run`

- [x] If `assetMode=dev_server`, use the live dev server.
- [x] Otherwise sync bundled assets first.
- [x] Run `npx cap run android`.

#### `jskit mobile android build`

- [x] Build production web assets.
- [x] Sync Android.
- [x] Run the Gradle bundle task that produces AAB.

### Stage 1E: Auth and Deep-Link Completion

#### TODO

- [x] Standardize one mobile auth callback flow:
  - [x] app opens external browser/custom tab
  - [x] provider redirects to `customscheme://auth/login?...`
  - [x] Capacitor receives URL
  - [x] JSKIT helper completes auth/session
  - [x] router resumes intended destination
- [x] Ensure login preserves intended destination.
- [x] Ensure logout clears session cleanly in mobile-shell context.
- [x] Support MVP deep-link scope:
  - [x] custom scheme only
  - [x] auth callback
  - [x] ordinary app route opening

### Stage 1F: Android Packaging and Release Path

#### TODO

- [x] Generate Android package/app-id config.
- [x] Add app-name wiring.
- [x] Add icon/splash workflow.
- [x] Add Android back-button guidance/default handling.
- [x] Add versionCode/versionName strategy.
- [x] Add AAB build path.
- [x] Document signing flow:
  - [x] upload key
  - [x] Play App Signing

### Stage 1G: Sample App and Verification

#### TODO

- [x] Choose one real JSKIT app as the reference implementation.
- [x] Package it with bundled local assets.
- [ ] Verify:
  - [ ] app launches
  - [ ] local bundled assets load
  - [ ] remote API calls work
  - [ ] login works
  - [ ] workspace route navigation works
  - [ ] deep links work
  - [ ] `google-rewarded-web` gate opens inside the Android shell
  - [ ] the rewarded video ad loads in the Android shell
  - [ ] reward completion reaches `google-rewarded-core`
  - [ ] unlock receipt state is written correctly
  - [ ] the gated feature unlocks correctly after reward grant
  - [x] release AAB builds
- [ ] Add tests:
  - [x] URL normalization unit tests
  - [x] auth callback resume tests
  - [x] mobile config resolution tests
  - [ ] one Android emulator smoke path
  - [x] one deep-link test
  - [x] one unknown-route fallback test
  - [x] one manual real-device QA checklist

### Stage 1H: Documentation and Guardrails

#### TODO

- [x] Document Android-first MVP scope clearly.
- [x] Document what mobile-shell support does not promise.
- [x] Document the generated `capacitor.config.json` shape, including:
  - [x] `webDir`
  - [x] `androidScheme`
  - [x] optional dev-server `url`
  - [x] `cleartext: true` in dev-server mode only
- [x] Document Play Store operational requirements:
  - [x] AAB requirement
  - [x] target SDK requirement
  - [x] Play App Signing
  - [x] Data safety form
  - [x] account deletion requirements when accounts exist
- [x] Add fitness/health policy guidance as documentation only.
- [x] Add billing guidance as documentation only.

### Stage 1 Exit Criteria

Do not start stage 2 as a platform commitment until all of these are true:

- [ ] `config.mobile` is real and stable enough for one production app
- [ ] `@jskit-ai/mobile-capacitor` scaffolds a working Android shell
- [ ] bundled assets work in production mode
- [ ] deep-link routing works
- [ ] mobile auth callback works
- [ ] one real app ships through the path
- [ ] the rewarded-ad flow is proven inside the Android shell
- [x] release AAB generation is proven
- [ ] docs match reality

## Stage 2: True Broad Mobile Platform

### Stage 2 Goal

Promote selected mobile capabilities into maintained JSKIT platform seams while
still using the same web app model.

This is no longer just packaging.

It means JSKIT intentionally supports a first-class `mobile-shell` runtime
target and a growing set of mobile-facing capabilities.

### Stage 2 Entry Rule

Do not begin stage 2 because the shell exists. Begin it only if:

- [ ] at least one real app is using stage 1 successfully
- [ ] recurring mobile needs appear across more than one app
- [ ] the team is willing to maintain mobile behavior as platform surface

### Stage 2A: First-Class Mobile Target

#### TODO

- [ ] Formalize `mobile-shell` as a JSKIT client target.
- [ ] Distinguish cleanly between:
  - [ ] browser
  - [ ] mobile-shell
- [ ] Make build/runtime/config aware of the target without forking the app
      model.
- [ ] Add package metadata support for:
  - [ ] mobile-safe
  - [ ] mobile-unsupported
  - [ ] capability requirements

### Stage 2B: Platform Capability Layer

Do not let feature packages import Capacitor directly everywhere.

#### TODO

- [ ] Define JSKIT capability seams for:
  - [ ] incoming app URL
  - [ ] app foreground/background state
  - [ ] back-button handling
  - [ ] safe-area access
  - [ ] keyboard state/overlap handling
- [ ] Make `mobile-capacitor` the first implementation of those seams.
- [ ] Keep capability APIs small and explicit.
- [ ] Avoid ad hoc `if native` checks spread across packages.

### Stage 2C: Selected Native-Adjacent Capabilities

Only promote capabilities that have real repeat demand.

#### Candidate TODO

- [ ] Share/open-in APIs
- [ ] File picking
- [ ] Camera/media capture
- [ ] basic device lifecycle hooks
- [ ] richer emulator/device testing support

These should be staged one by one, not promised as a bundle.

### Stage 2D: UI and Shell Maturity

If JSKIT claims broader mobile support, the shell experience needs explicit
care.

#### TODO

- [ ] Standard safe-area support
- [ ] keyboard-safe layout guidance/helpers
- [ ] back-button behavior guidance/helpers
- [ ] mobile-shell-specific QA guidance for common UI patterns
- [ ] package-level guidance for touch-friendly interactions where needed

This still does not mean a native UI framework.

### Stage 2E: Ecosystem and Doctor Support

#### TODO

- [ ] Extend `jskit doctor` with mobile-aware checks:
  - [ ] mobile config validity
  - [ ] callback scheme validity
  - [ ] shell files present
  - [ ] build output dir matches Capacitor config
  - [ ] target/capability mismatches
- [ ] Add compatibility guidance for package authors.
- [ ] Add reference docs for mobile-shell-safe package design.

### Stage 2F: Platform Expansions To Consider Later

These are separate product decisions, not automatic consequences of stage 2:

- [ ] verified app links
- [ ] Digital Asset Links management/docs
- [ ] iOS support
- [ ] notifications
- [ ] offline helpers
- [ ] biometric auth
- [ ] billing integrations
- [ ] background tasks

Each of these should enter only with its own scoped proposal.

### Stage 2 Exit Criteria

JSKIT can only claim broad mobile-platform support when:

- [ ] `mobile-shell` is a first-class maintained target
- [ ] capability seams exist and are used instead of direct Capacitor imports
- [ ] multiple real apps depend on the mobile support
- [ ] doctor/docs/testing all reflect the real support promise
- [ ] the team is prepared to maintain the added platform surface

## What Must Never Happen

These are roadmap anti-goals:

- [ ] no second route system for mobile
- [ ] no scattered direct Capacitor calls in feature packages by default
- [ ] no fake promise that JSKIT is a native UI framework
- [ ] no stage-3/4 native features smuggled into stage 1 work
- [ ] no claim of broad mobile support before one real app ships through the
      shell path

## Recommended Order

### Immediate

- [x] create `MOBILE-ROADMAP.md`
- [x] use this file as the staged replacement for the flat Capacitor backlog
- [x] narrow the active MVP to stage 1 only

### Next

- [x] implement stage 1A through 1C first
- [ ] prove one reference app before widening scope

### Later

- [ ] decide explicitly whether stage 2 is worth the long-term maintenance cost
