# Realtime

At the end of the previous chapter, the app already had a real shell, authenticated users, operator tooling, and workspace-aware routing. What it still did not have was a live transport for pushing updates into that shell.

This chapter installs `realtime`, which adds JSKIT's socket.io runtime, Vite websocket proxy wiring, and a small connection indicator in the shell.

This package is a good example of an "extra" rather than a new structural layer. It does not create new surfaces and it does not generate new pages. Instead, it plugs live behavior into things the guide has already scaffolded.

## Recap from previous chapters

To get back to the same starting point as the end of the previous chapter, run:

```bash
SUPABASE_URL=...
SUPABASE_KEY=...
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=exampleapp
DB_USER=exampleapp
DB_PASSWORD=secret

npx @jskit-ai/create-app exampleapp --tenancy-mode personal
cd exampleapp
npm install

npx jskit add package shell-web
npx jskit add package auth-provider-supabase-core \
  --auth-supabase-url "$SUPABASE_URL" \
  --auth-supabase-publishable-key "$SUPABASE_KEY" \
  --app-public-url "http://localhost:5173"
npx jskit add bundle auth-base
npx jskit add package database-runtime-mysql \
  --db-host "$DB_HOST" \
  --db-port "$DB_PORT" \
  --db-name "$DB_NAME" \
  --db-user "$DB_USER" \
  --db-password "$DB_PASSWORD"
npx jskit add package users-web
npx jskit add package console-web
npx jskit add package workspaces-core
npx jskit add package workspaces-web
npm install
npm run db:migrate
```

If you are already continuing from the previous chapter, you are already in the right place and can skip that setup.

<DocsTerminalTip label="Redis" title="Empty Is Fine Locally">
`realtime` writes `REALTIME_REDIS_URL` into `.env`, but leaving it empty is a perfectly normal local setup.

With no Redis URL, the package uses the in-memory socket adapter inside your single local Node process. That is enough for local development and for small single-instance deployments.

You only need to set `REALTIME_REDIS_URL` when you want several server instances to share socket events through Redis.
</DocsTerminalTip>

## Installing `realtime`

From inside `exampleapp`, run:

```bash
npx jskit add package realtime
npm install
```

The first command records the runtime package in the app and updates the existing scaffold. The second command downloads the new dependencies, especially `socket.io`, `socket.io-client`, and the optional Redis adapter pieces.

Unlike the database, users, console, and workspace chapters, this one does **not** need `npm run db:migrate`. `realtime` does not add schema files. It is transport infrastructure, not persistence.

## What changes now

Installing `realtime` changes the app in three important ways.

### The app gets a realtime transport

The server now mounts a socket.io runtime on the same Fastify server that already serves your JSKIT surfaces. The browser gets a matching socket.io client runtime through the normal client boot process.

That means later modules, or your own app code, can stop thinking only in terms of request/response HTTP flows. They can start publishing live events and listening for them in Vue.

### The shell gets a connection indicator

The package also uses the shell scaffolding that already exists.

`realtime` appends a placement entry into `src/placement.js` that targets `shell-layout:top-right`, so the shell starts showing a small status dot without you having to create a new page for it.

That dot is:

- green when the realtime socket is connected
- red when the socket is disconnected or still reconnecting

So the first visible value of the package is not a whole new screen. It is a tiny live status element plugged straight into the existing shell.

### Vite starts proxying websocket traffic too

The app already had a browser dev server on `5173` and a backend runtime on `3000`.

`realtime` extends that setup by writing a websocket proxy entry into `.jskit/vite.dev.proxy.json` for `/socket.io`. That matters because the browser should still talk to the frontend dev server on `5173`, while Vite quietly forwards websocket traffic to the backend runtime on `3000`.

So one of the main values of this package is that you do **not** have to hand-edit Vite config just to make socket.io work in local development.

### There are still no new pages

This is worth saying clearly because it can otherwise feel surprising.

After installing `realtime`:

- there is still no `/realtime` page
- there is still no new surface
- there is still no app-owned `src/pages/...` scaffold

That is intentional. `realtime` is infrastructure. It makes the existing shell and later runtime packages live-capable instead of giving the app a new section of its own.

## What to look at in the browser

Start both processes again:

```bash
npm run dev
npm run server
```

Then open `http://localhost:5173/home`.

The important visible change is in the top-right of the shell. You should now see the realtime status dot alongside the other shell controls.

If the websocket connects successfully, the dot is green. If the backend is unavailable or the socket is reconnecting, the dot is red. Hovering it shows the current status text.

That small change is the whole point of this chapter's browser check: the package is already active even though it did not create a page of its own.

## Using the client runtime

The connection indicator is useful, but the real reason to install `realtime` is to let client code subscribe to live events.

The smallest client-side example looks like this:

```vue
<script setup>
import { ref } from "vue";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";

const lastEvent = ref("Nothing received yet.");

useRealtimeEvent({
  event: "demo.ping",
  onEvent({ payload }) {
    lastEvent.value = JSON.stringify(payload);
  }
});
</script>

<template>
  <p>{{ lastEvent }}</p>
</template>
```

That composable does not create any server-side events by itself. It only subscribes the component to the client socket.

The important pieces are:

- `event`
  - the event name to listen for
  - if you omit it, the composable listens to `*`
- `onEvent`
  - the handler that receives `{ event, payload, socket }`
- `matches`
  - an optional predicate if you want to filter events before the handler runs

So the mental model is:

- `realtime` gives the app a live transport
- your own app code, or later packages, decide which events should travel across it

## What `realtime` adds to the app

This chapter is small enough that it is worth looking directly at the app-owned files it changes.

### `.env` gains the Redis adapter setting

The install writes:

```dotenv
REALTIME_REDIS_URL=
```

That empty value is deliberate. It means the app can start with the in-memory adapter locally, and you can fill in a real Redis URL later if you need cross-instance fan-out.

### `.jskit/vite.dev.proxy.json` gains a websocket proxy entry

After the install, the app has:

```json
{
  "version": 1,
  "entries": [
    {
      "packageId": "@jskit-ai/realtime",
      "id": "realtime-socket-io",
      "path": "/socket.io",
      "changeOrigin": true,
      "ws": true
    }
  ]
}
```

That one entry is what lets the browser dev server proxy websocket traffic correctly during local development.

### `src/placement.js` grows one new shell placement

The package appends this placement:

```js
addPlacement({
  id: "realtime.connection.indicator",
  target: "shell-layout:top-right",
  surfaces: ["*"],
  order: 950,
  componentToken: "realtime.web.connection.indicator"
});
```

That is a good example of JSKIT's placement model working as intended.

`realtime` does not need to own your shell component. It just contributes one widget into an outlet that `shell-web` already exposed.

### `package.json` gets the runtime dependencies

The install also adds the runtime packages needed for transport:

- `@jskit-ai/realtime`
- `socket.io`
- `socket.io-client`
- Redis adapter dependencies for scaled deployments

That is why `npm install` is still required even though this chapter only touches a small number of app-owned files.

## Under the hood

The internal model is simple.

- the server provider mounts socket.io at `/socket.io`
- the client provider creates one shared socket client for the Vue app
- the shell status dot is registered as `realtime.web.connection.indicator`

On the server side, the package also publishes container tokens such as:

- `runtime.realtime`
- `runtime.realtime.io`

And on the client side it publishes:

- `runtime.realtime.client.socket`

If `REALTIME_REDIS_URL` is empty, the server uses a normal single-process socket.io server. If the URL is set, the package enables the Redis adapter so several Node processes can share realtime events.

That is the right level of abstraction for this package:

- generic transport in the runtime
- visible status in the shell
- actual event meaning left to the app or to later packages

## Summary

This chapter does not make the app look radically different, but it adds an important new capability.

- the backend can now host a realtime socket server
- the frontend can now keep one shared websocket connection alive
- the shell now exposes a live connection indicator
- later modules can build live behavior on top of that transport without inventing their own websocket setup
