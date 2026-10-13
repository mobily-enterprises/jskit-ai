# Application runtime composition

Provides the capability, feature, action, HTTP, storage, realtime, and mobile
runtime primitives from which applications assemble their own behavior.

## Sources

- Main: `packages/kernel/server/features/index.js`
- `packages/http-runtime/src/client/index.js`
- `packages/storage-runtime/src/server/providers/StorageProvider.js`
- `packages/realtime/src/server/runtime.js`
- `packages/mobile-capacitor/src/client/runtime/mobileCapacitorRuntime.js`

## Public contract

Applications import explicit npm entry points and compose named capabilities,
providers, actions, and runtime adapters. Long-running work and application
policy remain owned by the consuming application. Missing requirements fail at
composition or at the relevant operation boundary rather than being resolved
through a global service locator.
