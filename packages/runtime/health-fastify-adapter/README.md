# @jskit-ai/health-fastify-adapter

Fastify adapter for liveness and readiness health checks.

## What this package is for

Use this package to expose standard health endpoints used by load balancers, container orchestrators, and uptime monitors.

It answers two different questions:

- `health` (liveness): Is the process alive?
- `readiness`: Is the app ready to receive production traffic?

## Key terms (plain language)

- `liveness`: whether the server process is running.
- `readiness`: whether dependencies (DB, cache, etc.) are ready enough to serve requests.

## Public API

## `createController(deps)`

Creates health controller handlers.

Returned handlers:

- `getHealth`
  - Returns liveness status.
  - Real example: Kubernetes liveness probe calls `/api/health`.
- `getReadiness`
  - Returns readiness status.
  - Real example: deployment waits for `/api/ready` to be healthy before shifting traffic.

## `buildRoutes(controller, options)`

Builds Fastify routes for health endpoints.

Real examples:

- `GET /api/health`
- `GET /api/ready`

## `schema`

Exports route schemas for request/response contracts.

Real example: operational docs/OpenAPI can show health response shape.

## How apps use this package (and why)

Typical flow:

1. App creates runtime/health service.
2. App creates controller from this adapter.
3. App registers routes during startup.

Why apps use it:

- standard probe endpoints without custom boilerplate
- consistent behavior across environments
