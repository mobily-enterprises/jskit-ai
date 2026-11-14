---
title: Run on More than One Server
description: Run a JSKIT app as several copies behind a load balancer, with files in an S3 bucket, live updates through Redis, sessions in the database, the same secrets on every copy, a lock for scheduled work and one migration run.
---

# Run on More than One Server

An app can run as several copies, on one machine or several, behind a load
balancer that sends each request to any of them. The copies share the
database. What one copy keeps on its own disk or in its own memory, the others
never see. Settle each item below before starting a second copy.

## Files

`runtime.storage`, where uploads and profile pictures go, keeps its files in a
folder on the machine by default, so a picture saved through one copy is
missing on the others. Point every copy at the same bucket:

```bash
JSKIT_STORAGE_DRIVER=s3
JSKIT_STORAGE_S3_BUCKET=shop-files
JSKIT_STORAGE_S3_REGION=eu-west-1
# R2, MinIO or another S3-compatible store; empty for AWS.
JSKIT_STORAGE_S3_ENDPOINT=
JSKIT_STORAGE_S3_ACCESS_KEY_ID=
JSKIT_STORAGE_S3_SECRET_ACCESS_KEY=
```

A missing required setting stops the app at startup, naming it. Give the
storage a bucket of its own. The `@jskit-ai/storage-runtime` README lists what
the `s3` driver does not do, such as listing past 1,000 objects; JSKIT's own
packages need none of it.

## Live updates

With `@jskit-ai/realtime`, each copy delivers an event only to the browsers
connected to it, unless every copy names the same Redis:

```bash
REALTIME_REDIS_URL=redis://redis.internal:6379
# Only when other apps share this Redis: keeps this app's channels apart.
REDIS_NAMESPACE=shop
```

Socket.IO starts each connection with HTTP long-polling, whose requests must
all reach the copy that opened it. Keep each browser on one copy at the load
balancer (sticky sessions), or connect by WebSocket only with
`realtimeClient: { options: { transports: ["websocket"] } }` in the app's
public config.

An assistant conversation's live progress reaches only the browsers connected
to the copy running its turn, with or without Redis; a browser on another copy
sees the saved conversation when it opens it again.

## Sign-in sessions

- Local sign-in with `@jskit-ai/auth-provider-local-db-core` keeps accounts and
  sessions in the database, so any copy reads any session and a sign-out or
  revocation holds on all of them. Without that package, they are files in
  `AUTH_LOCAL_STORE_DIR` (`.jskit/auth`) on each machine, which several copies
  cannot share, not even on a shared folder: its lock assumes one machine.
- OIDC sign-in keeps sessions in the database, and Supabase sign-in in the
  browser's cookies; both work on any copy.
- Every copy needs the same `AUTH_LOCAL_SESSION_SECRET`,
  `AUTH_LOCAL_SECOND_FACTOR_KEY`, `AUTH_OIDC_SESSION_SECRET` and
  `OIDC_HUB_SECRET`, as the app uses them. Staging and production (`APP_ENV`,
  see [Environments](/guide/framework/environments)) refuse to start without
  the session secrets; in development and test a missing one is generated into
  a file on each machine, so set them there too for several copies.
- On an empty staging or production database each copy makes its own
  first-account setup code, and a code from one copy is refused by the others.
  Set `AUTH_LOCAL_SETUP_CODE` on every copy, or run one copy until the first
  account exists.

## What each copy keeps to itself

- Request limits, a route's `rateLimit` and auth's limits on sign-in,
  registration, recovery and codes, count in each copy's memory: with three
  copies a client gets up to three times the limit. Local sign-in's wait for
  an account after repeated failures is kept in the database and holds across
  copies.
- An assistant conversation's one-turn-at-a-time check, steer and stop act on
  the copy running the turn. Sent to another copy, a second message is not
  refused and a stop does not stop the turn. Sticky sessions keep a browser's
  requests on one copy.
- `@jskit-ai/agent-runtime` writes command output under the system's temporary
  folder, so another copy cannot read a command's full output; point
  `createCommands`' `outputDir` at a folder every copy shares.

## Scheduled work

Work the app runs on a timer inside its own process, with `setInterval` or a
cron library, runs once in every copy. Make each run take a lock before it
works, as `@jskit-ai/agent-runtime`'s goal, run and summary loops do: one copy
claims a lease row with a conditional update, and the others find it taken
and skip. Work that only deletes expired rows can run in every copy, as the
OIDC hub's upkeep does.

## Migrations

Where the host has a Migrate step, run migrations once per release through
it, `npm run db:migrate` (`<name>-migrate` in a
[Nix package](/guide/app-setup/package-with-nix)), before the new copies
start. `npm run db:prepare` also runs the app's seed, so it runs once too, not
on every copy. A host with no such step migrates from each copy's start
(`<name> --migrate`) and restarts a copy that fails: Knex's migration lock
lets one copy migrate, and on PostgreSQL the others wait and then find nothing
left to do, while on MySQL they fail and start again, as the Nix guide's
[Migrations](/guide/app-setup/package-with-nix#migrations) section says.
