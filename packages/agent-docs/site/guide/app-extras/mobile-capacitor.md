# Mobile Capacitor

Use `@jskit-ai/mobile-capacitor` when the web application should run inside a
Capacitor Android shell.

```bash
npm install @jskit-ai/mobile-capacitor \
  @capacitor/android @capacitor/app @capacitor/cli
```

Use the `mobile/android-application` pattern for the small app-owned Capacitor
configuration. Then use Capacitor and Android tools directly:

```bash
npx cap add android
npm run build
npx cap sync android
npx cap run android
```

JSKIT does not wrap Capacitor, `adb`, Android Studio, or Gradle in another CLI.

## Product decisions

Choose the stable application id, display name, built web directory, callback
URLs, development server policy, native permissions, and signing/release
ownership before creating the Android project.

## Invariants

- `webDir` matches the application's production build output.
- Development origins never leak into release configuration.
- Deep links and auth callbacks enter through explicit application routes.
- Navigation leaving the application uses the package's public mobile routing
  capability.
- The Android project and signing configuration are ordinary app-owned source;
  signing secrets remain outside Git.

## Verification

Build the web application, sync Android, launch on an explicitly selected
device, exercise callbacks and external links, then build the intended native
release variant.

Do not hide device selection, write signing keys into source, or recreate a
JSKIT-specific mobile command language or operation receipt.
