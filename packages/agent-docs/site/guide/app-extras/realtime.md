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

When the entire realtime surface is authenticated, the selected `auth.service`
can expose `realtime.requireAuthentication: true`. The realtime server then
rejects unauthenticated handshakes before a socket joins any broadcast room.
Clients must disconnect and reconnect after their login identity changes so a
new handshake establishes the current actor.

When `auth.service.authenticateRequest()` is present, delivery reauthenticates
each socket before sending and rechecks idle sockets every 30 seconds. Revoked,
expired, or changed actors are disconnected. Workspace membership rooms are
refreshed from the current membership repository. Authentication lookup errors
fail closed.

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

## Visible connection state

A status indicator is optional product UI. When wanted, register it through the
normal component and placement APIs. Installing realtime does not append it to
the shell.

## Verification

Test in-process delivery, audience isolation, authenticated-handshake rejection
when selected, login-identity reconnects, disconnect/reconnect recovery,
duplicate listener cleanup, and live query refresh. When Redis is selected,
exercise delivery between two server processes.

Do not add realtime before event ownership is clear, invent undocumented
payloads, mutate placement source, or retain delivery receipts.
