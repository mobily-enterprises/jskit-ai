# Changelog

## Unreleased

- **Breaking.** The Redis backplane's address is read from `REALTIME_REDIS_URL`, the name the realtime guide, the `realtime/realtime-application` pattern and its `.env.example` give. It was read from `REDIS_URL`, so an app that set the documented name stayed on the in-process adapter, and each of its copies behind a load balancer delivered events only to the browsers connected to that copy. An app that set `REDIS_URL` for realtime sets `REALTIME_REDIS_URL` instead; `REDIS_NAMESPACE` is unchanged. The pattern's test now reads the name from the runtime, so the two cannot drift apart again.
- A publish to a user or workspace room no longer reads the memberships of every online actor. It asks each audience contributor about the actors of the sockets outside its target rooms only for those rooms' scopes, `resolveActorsScopes(actorIds, { scopes })`, and keeps only those rooms of the answer, while the actors already inside are looked up in full for their checks. A contributor that ignores `scopes` still answers correctly. Before, every write action read the memberships of every signed-in socket's actor, so the cost grew with everyone online, also for an event to one user.
- Since 0.2.20, an event a background job publishes (an action run with no request, so no request workspace) no longer reads its audience's `audienceUsers` in the `workspaceId` its payload names: with no workspace or user in its scope it reads with no context, so an audience over an owned table reaches nobody. Run the job's action with the workspace in its context (`context.workspace`, or a visibility scope naming it) so its audience reads there.
- Since 0.2.20, `all_workspace_users` on an event written on a customer's or a public surface reaches the users of the workspace the request resolved; before, such an event reached no workspace's users. An audience meant for the writer alone names the user instead.
- **Security.** An event written on a customer's or a public surface (scoped globally) reads its audience's `audienceUsers` in the workspace the request resolved, which the kernel adds to its global scope as `workspaceId` (`forWorkspace` of `realtime.audience-scope`), and `all_workspace_users` reaches that workspace. The payload never chooses the scope: an app's payload may copy an input id, and reading in a workspace the payload named let one event read in, and reach, another workspace. Before, such an event read with no context, so an audience over an owned table reached no customer. A scope that names a workspace or a user keeps it, and an event with neither reads with no context.
- **Breaking.** An audience given as a function of the execution, which the boot check cannot see, is checked when its event is published: without `realtime.audience-scope`, an entry that reads in the event's scope (an `audienceUsers` without `publicTablesOnly: true`) is logged as an error naming the socket event and entity, and skipped; the event still reaches the audience's other rooms. Before, it read with no context and silently missed the users of an owned table.
- An audience entry whose `audienceUsers` fails no longer loses the whole event: the failure is logged as an error naming the socket event and entity, the entry is skipped, and the event still reaches the audience's presets, rooms, users and other entries. Before, one failing read dropped the event for everybody, logged only as a warning.
- **Breaking.** `RealtimeProvider` refuses to boot when an action's event declares an audience whose `audienceUsers` reads in the event's scope and no feature provides `realtime.audience-scope`, naming those actions; before, each delivery read with no context and missed the users of an owned table. It reads the declared events through the optional `runtime.actions`. An audience that reads public tables only says `publicTablesOnly: true` and still needs no scope; an audience given as a function of the execution is not checked.

- A server without `REDIS_URL` no longer loads Redis: `redis` and `@socket.io/redis-adapter`, about 650 modules and 0.3 s on their own, are imported only when the Socket.IO Redis adapter is configured. Real app boots load 480 fewer modules. `configureSocketIoRedisAdapter`'s `createRedisConnection` and `createRedisAdapter` still default to them.
- `SESSION_REFRESH_REQUIRED` has its English in the catalog, so it translates.
- A publish to a user or workspace room checks only the sockets that can receive it: those already in a target room, those whose actor's contributed rooms include a target, and those not signed in yet. Before, once any audience contributor was registered, every connected socket was authenticated and had its actor's rooms looked up (one memberships query per online actor) inside the mutating request, and again on each Redis peer. A socket that cannot receive the publish is rechecked by the 30-second pass, as a socket outside any other room already was. An actor granted membership still receives the very next publish, and a removed or revoked one does not.
- Breaking: audience contributors register `resolveActorsScopes(actorIds)`, which returns, or resolves to, a `Map` from actor id to scopes, instead of `resolveActorScopes(actorId)`. A publish, and each 30-second pass, asks each contributor once for every actor it needs, whatever the number of connected sockets, and the sockets it then checks share that answer.
- **Breaking (data-access redesign).** An audience entry reaches users that a record's owner knows through `audienceUsers({ event, options })`, which answers, or resolves to, a list of user ids. It is asked once per event, however many sockets receive it. With `RealtimeAudienceScopeFeature` registered, `options.context` is a system job context scoped to the event's workspace, its user in its workspace, or its user (`forWorkspace`, `forWorkspaceUser` or `forUser` of `realtime.audience-scope`), so the owners' APIs it calls answer for that scope; without it, `options` carries no context, which reaches public tables only. `userQuery({ knex, event })` is removed, and realtime no longer takes the optional `runtime.database`; `createRealtimeDelivery` no longer takes `database`.

- New `RealtimeAudienceScopeFeature` (`@jskit-ai/realtime/server/RealtimeAudienceScopeFeature`) provides `realtime.audience-scope`: it declares the system scope that reads the users an event's audience reaches and derives the event's scoped contexts from it. `RealtimeProvider` takes it as an optional capability, so a server without a database keeps realtime; an app whose audiences read owned tables registers the feature.

### Upgrading

- An app whose action events declare an `audienceUsers` audience registers `RealtimeAudienceScopeFeature`, or marks an audience that reads only public tables `publicTablesOnly: true`; otherwise it no longer boots.
- An app whose audiences call owners' APIs on owned tables registers `RealtimeAudienceScopeFeature` beside `RealtimeProvider`.
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
