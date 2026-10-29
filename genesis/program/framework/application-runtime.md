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

JSKIT's Vite plugin names each built HTML page's build in a
`jskit-client-build` meta tag, a digest of the page's content-hashed script and
style names. On every connection, including the reconnection to a restarted
server, realtime sends the build of the page the app serves now
(`dist/index.html`), and its client capability passes it to
`onServedClientBuild` listeners. No polling or extra request is involved.
