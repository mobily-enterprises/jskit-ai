# `@jskit-ai/mobile-capacitor`

Stage 1 Android mobile-shell support for JSKIT.

This package does not turn JSKIT into a native UI framework. It packages the
existing JSKIT web client into a Capacitor Android shell and owns the narrow
glue needed for:

- launch URL intake
- deep-link normalization into normal JSKIT routes
- auth callback completion on `/auth/login`
- Android shell file rendering from `config.mobile`
- `jskit mobile` add/sync/run/build/doctor/devices/tunnel/restart commands
- `jskit mobile` add/sync/run/build/doctor/devices/tunnel/restart/dev commands

## Stage 1 Scope

Stage 1 promises:

- Android only
- JSKIT web UI inside a Capacitor shell
- bundled production assets
- optional live `dev_server` runtime mode
- OAuth start opens the external browser/custom tab when running inside the
  Capacitor shell
- browser-to-app auth callback completion through the existing JSKIT auth flow
- release AAB command path

Stage 1 does not promise:

- native UI abstractions
- iOS parity
- push notifications
- offline-first behavior
- billing integrations
- verified app links
- direct Capacitor imports as a normal feature-package pattern

## `config.mobile`

`config.mobile` is the source of truth.

```js
config.mobile = {
  enabled: true,
  strategy: "capacitor",
  appId: "ai.jskit.exampleapp",
  appName: "Example App",
  assetMode: "bundled", // bundled | dev_server
  devServerUrl: "",
  apiBaseUrl: "http://10.0.2.2:3000",
  auth: {
    callbackPath: "/auth/login",
    customScheme: "exampleapp",
    appLinkDomains: []
  },
  android: {
    packageName: "ai.jskit.exampleapp",
    minSdk: 26,
    targetSdk: 35,
    versionCode: 1,
    versionName: "0.1.0"
  }
};
```

Important rules:

- `callbackPath` stays a normal JSKIT path. Stage 1 does not create a second
  mobile-only route system.
- `assetMode="bundled"` is the release path.
- `assetMode="dev_server"` is for local development only and requires
  `devServerUrl`.

## Generated Artifacts

`jskit mobile add capacitor` installs the package and manages:

- `capacitor.config.json`
- `android/` via `cap add android`
- `.jskit/mobile-capacitor.md`
- the managed deep-link filter in `android/app/src/main/AndroidManifest.xml`
- Android identity files refreshed from `config.mobile`:
  - `android/app/build.gradle`
  - `android/variables.gradle`
  - `android/app/src/main/res/values/strings.xml`
  - `MainActivity.java` or `MainActivity.kt`

These files are not app-owned drift zones. `jskit mobile sync android` is
expected to refresh them from `config.mobile`.

## `capacitor.config.json`

Stage 1 currently renders:

```json
{
  "appId": "ai.jskit.exampleapp",
  "appName": "Example App",
  "webDir": "dist",
  "plugins": {
    "CapacitorHttp": {
      "enabled": true
    }
  }
}
```

In `assetMode="dev_server"`, it additionally renders:

```json
{
  "server": {
    "url": "http://10.0.2.2:5173/",
    "cleartext": true
  }
}
```

Notes:

- `webDir` is always `dist` in Stage 1.
- `server.url` is only present in `dev_server` mode.
- `cleartext: true` is only rendered when the dev server URL uses `http`.
- `CapacitorHttp.enabled = true` is always rendered so shell `fetch` / XHR
  traffic can use the native HTTP bridge.
- JSKIT does not currently set `androidScheme` explicitly. Stage 1 relies on
  Capacitor's default local Android scheme instead of inventing another app
  config field.

## Command Contract

Install path:

- canonical package install:
  - `jskit add package @jskit-ai/mobile-capacitor`
- convenience alias:
  - `jskit mobile add capacitor`
- both paths now use the same package-owned install hooks:
  - seed `config.mobile` when missing
  - install Capacitor dependencies
  - provision `android/` with `cap add android` when needed
  - refresh the managed Android shell identity/deep-link files

`jskit mobile add capacitor`

- installs `@jskit-ai/mobile-capacitor`
- installs the required Capacitor packages
- adds managed npm scripts
- seeds `config.mobile` with working JSKIT local-dev defaults when it is missing
- renders managed config files
- runs `cap add android` if `android/` does not exist

`jskit mobile devices android`

- runs `adb devices -l`
- prints the Android targets currently visible to adb

`jskit mobile dev android [--target <device-id>]`

- runs the standard local-phone sequence in one command:
  - `jskit mobile sync android`
  - `jskit mobile run android --target <device-id>`
  - `jskit mobile tunnel android --target <device-id>`
- prints each step and the full command before it runs
- if `--target` is omitted, uses the first Android device from `adb devices -l`

`jskit mobile sync android`

- refreshes managed mobile files from `config.mobile`
- refreshes Android shell identity from `config.mobile`
- builds the web app
- runs `cap sync android`

`jskit mobile tunnel android --target <device-id>`

- resolves the loopback port from `config.mobile.apiBaseUrl`, or uses `--port`
- runs `adb -s <device-id> reverse tcp:<port> tcp:<port>`
- prints `adb reverse --list` so the active tunnel is visible

`jskit mobile restart android --target <device-id>`

- clears app data with `pm clear`
- force-stops the Android app
- cold-starts `MainActivity`

`jskit mobile run android [--target <device-id>]`

- in `bundled` mode:
  - runs the normal sync flow first
- in `dev_server` mode:
  - refreshes managed config files
  - syncs the Android shell without rebuilding bundled assets
- then runs `cap run android`
- forwards `--target` to Capacitor when you want a specific attached phone/emulator

`jskit mobile build android`

- requires `assetMode="bundled"`
- builds the web app
- syncs Android
- runs Gradle `bundleRelease`

`jskit mobile doctor`

- validates `config.mobile`
- validates managed file freshness
- validates the Android shell is installed
- validates the managed deep-link filter
- validates Android SDK basics needed by the shell path

## Stage 1 Modes

Stage 1 distinguishes only these modes:

- normal web app with no mobile shell
- mobile-shell packaged build
- mobile-shell dev-server build

That is enough target awareness for Stage 1. It is not a broad mobile runtime
target model.

## Auth And Routing Contract

Stage 1 keeps routing web-path based:

- custom-scheme URLs normalize into ordinary JSKIT router paths
- allowed HTTPS app links normalize into ordinary JSKIT router paths
- OAuth start stays the normal auth-web route on the server, but
  `@jskit-ai/mobile-capacitor` launches it through `@capacitor/browser` when the
  app is running inside the shell
- auth callback completion still happens through `/auth/login`
- intended destination is carried through OAuth start and OAuth completion

Unknown deep-link paths are still handed to the normal app router. Stage 1 does
not invent a parallel mobile fallback system.

## Icons And Splash Screens

Stage 1 uses a documented manual workflow:

- update the Android shell resources in `android/app/src/main/res/`
- regenerate launcher assets with Android Studio or your normal Android asset
  pipeline
- keep the package/app identity values managed by JSKIT, but treat visual
  launcher assets as Android-owned assets

JSKIT does not yet automate icon or splash asset generation.

## Release Notes

Release builds are expected to use:

- `config.mobile.assetMode = "bundled"`
- `jskit mobile build android`

That command is the Stage 1 AAB path. A working Android SDK still needs:

- platform `android-35`
- build-tools
- accepted SDK licenses

Signing remains an operational workflow:

- create an upload key
- configure Play App Signing
- keep signing secrets out of app source

## Play Store Operational Checklist

Before publishing, confirm:

- release output is an AAB
- target SDK matches current Play requirements
- Play App Signing is configured
- the Data safety form matches the app's actual behavior
- account deletion requirements are met if the app offers user accounts

These are operational docs, not a JSKIT runtime abstraction.

## Domain Notes

Fitness/health and billing are Stage 1 documentation concerns only:

- health/fitness apps still need to satisfy store policy for their domain
- rewarded-ad or monetized flows still need to satisfy provider/store policy
- billing decisions should be designed explicitly; Stage 1 mobile-shell support
  does not solve billing architecture

## Manual QA Checklist

Minimum real-device or emulator QA for a Stage 1 app:

- app installs and launches
- bundled assets load in production mode
- API calls hit the real backend
- OAuth start opens the external browser/custom tab when the app is running in
  the shell
- login returns through the custom scheme to `/auth/login`
- intended destination resumes after OAuth
- workspace routes open through deep links

## Local Phone Development

When `config.mobile.apiBaseUrl` points at a local loopback server like
`http://127.0.0.1:3000`, the phone cannot reach your laptop directly. The
required JSKIT workflow is:

1. run the local backend
2. `jskit mobile sync android`
3. install or launch the shell
4. `jskit mobile tunnel android --target <device-id>`
5. `jskit mobile restart android --target <device-id>` when you need a clean
   signed-out state

If `config.mobile.apiBaseUrl` points at a real remote `https://...` backend,
the reverse tunnel is not needed.
- an unknown app deep link is handed to the normal router/404 path without
  crashing the shell
- Android back button navigates back or exits cleanly at the app root
