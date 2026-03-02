# `@jskit-ai/assistant-fastify-routes`

## What This Package Is For

`@jskit-ai/assistant-fastify-routes` exposes the Assistant HTTP transport surface for Fastify.

It owns:

1. Route schema (`createSchema`, `schema`).
2. Route registration descriptors (`buildRoutes`).
3. HTTP controller handlers (`createController`).
4. NDJSON stream helpers for Assistant event streaming.

## Why Apps Use It

Apps compose this package with `@jskit-ai/assistant-core`:

1. `assistant-core` handles provider orchestration + tool execution logic.
2. `assistant-fastify-routes` handles HTTP request/response + route schema/metadata.

This keeps transport concerns separate from domain/service concerns.

## Public API

- `createController(options)`
- `buildRoutes(controllers, options)`
- `createSchema(options)` / `schema`
- `setNdjsonHeaders(reply)`
- `writeNdjson(reply, payload)`
- `endNdjson(reply)`
- `safeStreamError(reply, payload)`
