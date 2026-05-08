# Mobile Capacitor

This chapter explains how to put a JSKIT app on an Android phone with the
Capacitor shell.

The normal result is:

- your JSKIT web app runs inside an Android shell
- the app can talk to your backend
- deep links and auth callback routing still go through normal JSKIT routes
- you can rebuild, reinstall, tunnel, and restart with `jskit mobile ...`

## Install it

From the app root:

```bash
npx jskit add package @jskit-ai/mobile-capacitor
```

That command:

- installs `@jskit-ai/mobile-capacitor`
- installs the required Capacitor packages
- seeds `config.mobile` if it is missing
- renders `capacitor.config.json`
- provisions `android/`
- refreshes the managed Android shell files from `config.mobile`

After that, run:

```bash
npx jskit mobile android doctor
```

If doctor passes, the app is ready for the normal mobile workflow.

## What you need on your machine

::: tip Required Host Tools
Before this workflow is healthy, the machine needs all of the following:

- `adb` on `PATH`
- Android SDK installed, with the required platform and build-tools
- a full JDK, not just a runtime
- `java` on `PATH`
- `javac` on `PATH`
- `ANDROID_HOME` or `ANDROID_SDK_ROOT` set, or `android/local.properties` with `sdk.dir=...`
- `JAVA_HOME` pointing at a full JDK if `java` / `javac` are not already resolved correctly from `PATH`

The end state should be:

- `adb devices -l` works
- `java -version` works
- `javac -version` works
- `npx jskit mobile android doctor` passes
:::

If you installed Android Studio, its bundled JDK is often the easiest working
Java home:

```bash
export JAVA_HOME="$HOME/android-studio/jbr"
export PATH="$JAVA_HOME/bin:$PATH"
```

## Put the app on your phone

Start the backend first:

```bash
PORT=3000 npm run server
```

Then use the all-in-one command:

```bash
npx jskit mobile android dev
```

This is the one-stop shop for local Android phone testing.

It runs these commands in this exact order:

```bash
npx jskit mobile android sync
npx jskit mobile android tunnel
npx jskit mobile android run
```

That first step is important: for bundled apps, `npx jskit mobile android sync` runs `npm run build` first and then runs `cap sync android`. So yes, `npx jskit mobile android dev` does build the app before it installs/runs the Android shell.

If more than one Android device is attached:

```bash
npx jskit mobile android devices
npx jskit mobile android dev --target <device-id>
```

That is the shortest path.

## Manual commands

If you want to run the steps yourself instead of using `mobile android dev`,
these are the commands that matter.

### List devices

```bash
npx jskit mobile android devices
```

Prints the Android devices currently visible to `adb`.

### Sync the Android shell

```bash
npx jskit mobile android sync
```

This:

- refreshes the managed mobile files from `config.mobile`
- builds the JSKIT web app into `dist/`
- runs `cap sync android`

### Create the local tunnel

```bash
npx jskit mobile android tunnel
```

If you want a specific device:

```bash
npx jskit mobile android tunnel --target <device-id>
```

This command creates the `adb reverse` tunnel that lets the phone reach your
laptop's local backend.

### Install and run the app

```bash
npx jskit mobile android run
```

Or:

```bash
npx jskit mobile android run --target <device-id>
```

This launches the Android shell through Capacitor.

### Restart cleanly

```bash
npx jskit mobile android restart
```

Or:

```bash
npx jskit mobile android restart --target <device-id>
```

This:

- clears app data
- force-stops the Android app
- cold-starts `MainActivity`

Use it when you want a clean signed-out state.

## The command set

These are the mobile commands the package adds:

- `jskit mobile android devices`
  - list visible Android devices
- `jskit mobile android doctor`
  - validate config, shell files, SDK, and host readiness
- `jskit mobile android dev`
  - run the standard local-phone development flow
- `jskit mobile android sync`
  - rebuild and sync the Android shell
- `jskit mobile android tunnel`
  - create and verify the `adb reverse` tunnel
- `jskit mobile android run`
  - launch the Android shell
- `jskit mobile android restart`
  - clear app data and cold-start the app
- `jskit mobile android build`
  - build the Android release bundle

## The default local-dev setup

When `jskit add package @jskit-ai/mobile-capacitor` seeds `config.mobile` for the first time, it
creates a working local-dev default.

The important part is:

```js
config.mobile = {
  enabled: true,
  strategy: "capacitor",
  assetMode: "bundled",
  apiBaseUrl: "http://127.0.0.1:3000",
  auth: {
    callbackPath: "/auth/login",
    customScheme: "your-app-slug"
  }
};
```

That default is good for local phone development against your laptop.

It also means:

- the backend must be running on your laptop
- the app needs an `adb reverse` tunnel

If `apiBaseUrl` later points to a real remote `https://...` backend, the tunnel
is no longer required.

## A good day-to-day loop

Once the package is installed, the normal loop is:

```bash
PORT=3000 npm run server
npx jskit mobile android dev
```

If you want to rerun steps manually, a predictable sequence is:

```bash
npx jskit mobile android sync
npx jskit mobile android tunnel
npx jskit mobile android run
```

And if you need a clean state afterward:

```bash
npx jskit mobile android restart
```

## Behind the scenes

### `config.mobile` is the source of truth

The Android shell is not configured by hand in scattered native files. JSKIT
renders the shell from `config.mobile`.

That config drives:

- Capacitor app id and app name
- Android package name
- app version values
- API base URL
- auth callback path
- custom URL scheme

### The shell is still a JSKIT web app

The UI still comes from the JSKIT web client.

Stage 1 mobile does not turn JSKIT into a native UI framework. It packages the
web app into a Capacitor Android shell.

That is why `jskit mobile android sync` still builds the web app first.

### Managed files

The package manages:

- `capacitor.config.json`
- `.jskit/mobile-capacitor.md`
- the Android shell under `android/`
- managed Android identity files such as:
  - `android/app/build.gradle`
  - `android/variables.gradle`
  - `android/app/src/main/res/values/strings.xml`
  - `MainActivity.java` or `MainActivity.kt`
- the managed deep-link block in `AndroidManifest.xml`

`jskit mobile android sync` is expected to refresh those files from
`config.mobile`.

### Why the tunnel exists

Inside the Android shell, the phone's `127.0.0.1` is the phone itself, not your
laptop.

So when local development uses:

```text
http://127.0.0.1:3000
```

the phone still needs a bridge back to your laptop.

That bridge is:

```bash
adb reverse tcp:3000 tcp:3000
```

`jskit mobile android tunnel` wraps that and shows `adb reverse --list`
afterward so you can see the active mapping.

### What happens to URLs

Inside the Capacitor shell there are two relevant URL worlds:

- shell/webview origin:
  - `https://localhost/...`
- backend/API origin:
  - usually `config.mobile.apiBaseUrl`

JSKIT keeps app code using normal relative server paths such as:

- `/api/session`
- `/api/bootstrap`
- `/socket.io/...`

The mobile runtime adapts those requests to the configured backend origin.

That is why app code does not need a separate "mobile API client" pattern for
the standard JSKIT server routes.

### Why local HTTP works on Android

For the local-dev case, the backend URL is often plain `http`.

The mobile shell therefore needs:

- Capacitor native HTTP enabled
- Android cleartext traffic allowed for the generated shell

Without those, Android or the WebView will block local backend traffic even if
the tunnel itself is correct.

### Auth and deep links

The mobile shell does not invent a separate auth route system.

The normal contract stays:

- OAuth start opens in the external browser/custom tab
- callback returns through the app's custom scheme
- callback path is still the normal JSKIT path:
  - `/auth/login`

Deep links and auth completion are normalized back into the normal JSKIT router.

### What `doctor` is actually checking

`jskit mobile android doctor` is the preflight command for this whole lane.

It checks:

- `config.mobile`
- managed shell file freshness
- Android shell presence
- deep-link wiring
- Android SDK basics
- host readiness for the shell path

If mobile work looks strange, run doctor first.
