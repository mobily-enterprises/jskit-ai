# Realtime

Install realtime only when the product needs server-to-client events or live
query refresh.

```bash
npm install @jskit-ai/realtime
```

The package provides the server delivery capability and client listener
runtime. It adds no schema and needs no migration.

Use the `realtime/realtime-application` pattern for event delivery, optional
Redis configuration, client invalidation, and an explicit shell status
placement.

## Event contract

Successful actions may declare domain events. Realtime delivery occurs only
when an event has an explicit realtime name and audience. The event name,
scope, payload, and reconnect behavior are public product contracts—not a
generic “something changed” escape hatch.

Client features register listeners through `@jskit-ai/realtime`. Keep query
invalidation close to the resource that owns the query keys.

`useRealtimeEvent()` follows its Vue effect scope. Ordinary component listeners
detach when that component unmounts. A listener created inside an application-owned
detached scope remains active after its original screen unmounts and detaches when
that scope is stopped. Retain and release that scope with the resource's actual
owners; a hidden screen alone must not dispose a conversation still used by voice.

When the entire realtime surface is authenticated, the selected `auth.service`
can expose `realtime.requireAuthentication: true`. The realtime server then
rejects unauthenticated handshakes before a socket joins any broadcast room.
Clients must disconnect and reconnect after their login identity changes so a
new handshake establishes the current actor.

When `auth.service.authenticateRequest()` is present, delivery reauthenticates
each socket before sending and rechecks idle sockets every 30 seconds. Revoked,
expired, or changed actors are disconnected. Authentication lookup errors fail
closed.

Packages that know which scopes an actor belongs to contribute them through
`runtime.realtime.registerAudienceContributor({ id, resolveActorScopes })` during
setup. `resolveActorScopes(actorId)` returns event scopes (`{ kind: "user", id }`,
`{ kind: "workspace", id }` or `{ kind: "workspace_user", workspaceId, userId }`);
realtime turns each into the same room an `event_scope` audience targets. Sockets
join those rooms on connection and, on every revalidation, leave the contributed
rooms the actor no longer belongs to; rooms joined by anything else are left
alone. `@jskit-ai/workspaces-core` contributes the actor's active workspace
memberships this way when realtime is installed.

The authentication request includes parsed cookies, the `Host`, `Origin` and
`X-Forwarded-Proto` headers when present, and the socket address and TLS state.
Applications own their origin policy and decide which proxy headers to trust;
forwarding this context does not itself authorize an origin.

For application-specific access rules, expose
`auth.service.realtime.authorizeEvent({ actor, event: { name, payload } })`.
Only an explicit `true` permits delivery. The actor is the current server-side
authentication result, so the application can reuse its HTTP read policy.
Audience rooms select candidates; they never bypass this authorization callback.
With Redis, each receiving server authorizes its own sockets before delivery.

Only the explicit realtime payload and canonical event fields (`type`, `source`,
`entity`, `operation`, `entityId`, `scope`, `actorId`, `commandId`,
`sourceClientId`, `occurredAt`) reach clients. Other domain metadata stays on the
server. Put intentional public fields in `realtime.payload`.

Realtime delivery errors are logged and do not reject the domain event or undo
a successful action. Domain listeners retain their own error semantics.
Refresh hints are best effort; use authoritative reads on reconnect to recover
missed events. There is no event journal, replay, or exactly-once guarantee.
Keep one completion publisher beside the mutation owner; lifecycle progress
events may still describe distinct intermediate states.

## Single process and Redis

The in-process adapter is correct for one server process. Set
`REALTIME_REDIS_URL` only when multiple processes need a shared backplane.
Credentials stay outside Git and never enter public client config.

## Shutdown

Realtime shutdown refuses new Socket.IO requests and closes its engine, adapter
and Redis connections. Clients see their transport close, as with
`Server#close()`, so Socket.IO's own reconnection reaches the next server; the
server never sends a disconnect that would stop it. It never closes the HTTP
server: that belongs to its owner (Fastify closes its own after feature
shutdown), so another route's open WebSocket or stream does not hold realtime
shutdown. Code that passes its own `httpServer` to `createSocketIoServer` closes
that server itself after `closeSocketIoServer`.

## Client updates

An open page keeps running the client code it loaded until it reloads, so after
an update it can run old code indefinitely. JSKIT's Vite plugin
(`createJskitClientBootstrapPlugin`) names each production-built HTML page's
build in `<meta name="jskit-client-build" content="...">`: a digest of the page,
whose content-hashed script and style names change whenever any built code or
style does. The same source builds the same id. Vite's development pages have
none.

On every connection, including the reconnection to a restarted server, the
realtime server sends `realtime.served-client-build` with `{ buildId }`: the
build of the page the app serves now, read from `dist/index.html` under
`runtime.app-root`. It is read for each connection, so a page rebuilt while the
server runs counts at once. With no built page, nothing is sent. The client
capability's `onServedClientBuild(listener)` calls the listener with each
announced id, and at once with the latest one; it returns the unsubscribe
function. There is no polling and no extra request.

When `@jskit-ai/shell-web` is installed, a page whose own build differs from the
served one reports an `app-recoverable` notice, a banner under the default
policy: "*Title* was updated. Reload to get the latest version.", where *Title*
is the page's `<title>` as it loaded ("This app" without one), with a **Reload**
action. The page never reloads by itself, because the person may be in the
middle of something. **Reload** checks that the server answers, then reloads
the same address. The notice appears once per served build: a reconnection to
the same build does not repeat it, closing it keeps it closed until a newer
build, and a server back on the page's own build withdraws it.

## Visible connection state

A status indicator is optional product UI. When wanted, register it through the
normal component and placement APIs. Installing realtime does not append it to
the shell.

The standard status indicator is a button while disconnected. Clicking it starts
a fresh connection attempt at once, even while Socket.IO is waiting out a
reconnection delay; application reconnect controls use `reconnectSocketIoClient`
from `@jskit-ai/realtime/client/runtime` for the same behavior. The client also
retries server-initiated disconnects and rejected handshakes, backing off from
one second to at most thirty seconds. Those extra retries pause while the page
is hidden or offline. When it becomes visible or online again, a disconnected
socket reconnects immediately instead of finishing a delay scheduled before the
device slept. Socket.IO continues to own ordinary transport reconnection.
Explicit client disconnection and `reconnection: false` remain respected.

Every attempt goes through normal authentication. Reconnection does not restore
revoked access; an expired login still requires signing in. Applications should
preserve unsent input, distinguish disconnected status from running work, and
refresh authoritative state after reconnecting without resending mutations.

## Verification

Test in-process delivery, audience isolation, authenticated-handshake rejection
when selected, login-identity reconnects, disconnect/reconnect recovery,
duplicate listener cleanup, and live query refresh. When Redis is selected,
exercise delivery between two server processes.

Do not add realtime before event ownership is clear, invent undocumented
payloads, mutate placement source, or retain delivery receipts.
