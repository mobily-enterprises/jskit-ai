# Platform Runtime Migration

## Extracted Package

- `@jskit-ai/platform-server-runtime`

## App Wiring Pattern

- Runtime assembly and platform bundle creation use package helpers:
  - `createPlatformRuntimeBundle`
  - `createServerRuntimeWithPlatformBundle`
- App runtime files stay thin and focus on composition inputs.

## Extension Points For New Apps

- Provide app feature bundles separately.
- Keep platform bundle composition centralized and package-driven.
