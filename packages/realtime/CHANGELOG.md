# Changelog

## Unreleased

- A server without `REDIS_URL` no longer loads Redis: `redis` and `@socket.io/redis-adapter`, about 650 modules and 0.3 s on their own, are imported only when the Socket.IO Redis adapter is configured. Real app boots load 480 fewer modules. `configureSocketIoRedisAdapter`'s `createRedisConnection` and `createRedisAdapter` still default to them.
- `SESSION_REFRESH_REQUIRED` has its English in the catalog, so it translates.
- A publish to a user or workspace room checks only the sockets that can receive it: those already in a target room, those whose actor's contributed rooms include a target, and those not signed in yet. Before, once any audience contributor was registered, every connected socket was authenticated and had its actor's rooms looked up (one memberships query per online actor) inside the mutating request, and again on each Redis peer. A socket that cannot receive the publish is rechecked by the 30-second pass, as a socket outside any other room already was. An actor granted membership still receives the very next publish, and a removed or revoked one does not.
- Breaking: audience contributors register `resolveActorsScopes(actorIds)`, which returns, or resolves to, a `Map` from actor id to scopes, instead of `resolveActorScopes(actorId)`. A publish, and each 30-second pass, asks each contributor once for every actor it needs, whatever the number of connected sockets, and the sockets it then checks share that answer.
- **Breaking (data-access redesign).** An audience entry reaches users that a record's owner knows through `audienceUsers({ event, options })`, which answers, or resolves to, a list of user ids. It is asked once per event, however many sockets receive it, and `options.context` is the event's own scope (a workspace, workspace-user or user visibility context), so the owners' APIs it calls answer for that scope. `userQuery({ knex, event })` is removed, and realtime no longer takes the optional `runtime.database`; `createRealtimeDelivery` no longer takes `database`.

### Upgrading

- An audience that provided `userQuery({ knex, event })` provides `audienceUsers({ event, options })` instead, asking the record's owner for the users (for example `activeMemberIds(workspaceId, options)` of `workspaces.memberships`) and answering their ids rather than rows.

### New codes (1)

<details><summary>Code list</summary>

- `SESSION_REFRESH_REQUIRED`

</details>

### New message keys (1)

<details><summary>Key list</summary>

- `jskit.errors.SESSION_REFRESH_REQUIRED`

</details>

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".

### New message keys (6)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.realtime.indicator.connected`
- `jskit.realtime.indicator.connectedTooltip`
- `jskit.realtime.indicator.disconnected`
- `jskit.realtime.indicator.disconnectedTooltip`
- `jskit.realtime.indicator.reconnect`
- `jskit.realtime.indicator.unavailableTooltip`

</details>
