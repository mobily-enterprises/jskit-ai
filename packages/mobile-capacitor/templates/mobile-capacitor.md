# Mobile Capacitor

This file is managed by `@jskit-ai/mobile-capacitor`.

Installed contract:

- strategy: `capacitor`
- asset mode: `__JSKIT_MOBILE_CAPACITOR_ASSET_MODE__`
- dev server url: `__JSKIT_MOBILE_CAPACITOR_DEV_SERVER_URL__`
- API base URL: `__JSKIT_MOBILE_CAPACITOR_API_BASE_URL__`
- auth callback path: `__JSKIT_MOBILE_CAPACITOR_CALLBACK_PATH__`
- custom scheme: `__JSKIT_MOBILE_CAPACITOR_CUSTOM_SCHEME__`
- app link domains: `__JSKIT_MOBILE_CAPACITOR_APP_LINK_DOMAINS__`
- Capacitor app id: `__JSKIT_MOBILE_CAPACITOR_APP_ID__`
- Capacitor app name: `__JSKIT_MOBILE_CAPACITOR_APP_NAME__`
- Android package name: `__JSKIT_MOBILE_CAPACITOR_ANDROID_PACKAGE_NAME__`
- Android min SDK: `__JSKIT_MOBILE_CAPACITOR_ANDROID_MIN_SDK__`
- Android target SDK: `__JSKIT_MOBILE_CAPACITOR_ANDROID_TARGET_SDK__`
- Android version code: `__JSKIT_MOBILE_CAPACITOR_ANDROID_VERSION_CODE__`
- Android version name: `__JSKIT_MOBILE_CAPACITOR_ANDROID_VERSION_NAME__`

Owned artifacts:

- `capacitor.config.json`
- `android/` after `jskit mobile add capacitor` runs `cap add android`
- `android/app/src/main/AndroidManifest.xml` managed deep-link intent filter for the custom scheme

Managed commands:

- `jskit mobile add capacitor`
- `jskit mobile sync android`
- `jskit mobile run android`
- `jskit mobile build android`
- `jskit mobile doctor`

Current Stage 1 limits:

- Android only
- web assets stay the JSKIT web client
- OAuth start uses the external browser/custom tab only when the app is running inside the Capacitor shell
- auth/deep-link handling stays routed through normal JSKIT paths
- native app-link verification is still out of scope for Stage 1
