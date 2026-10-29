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

Realtime action events reach only the rooms their audience names. The default
`event_scope` audience delivers to the event's user, workspace, or
workspace-user room and to nobody when the event has no such scope. Every
signed-in user is reached only through the explicit `all_users` audience, which
a CRUD feature selects with its `realtimeAudience` option.

With an authenticating `auth.service`, each publish reauthenticates, before
sending, every socket that could receive it: all sockets for a broadcast, the
target rooms' members otherwise, and every socket when a registered audience
contributor could add a target user or workspace room. Identical socket
requests share one check within that publish; no result outlives it. A revoked
login or removed membership therefore stops the very next publish that would
reach it, and a 30-second pass rechecks every socket.
