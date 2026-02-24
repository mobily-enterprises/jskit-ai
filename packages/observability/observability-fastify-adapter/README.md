# @jskit-ai/observability-fastify-adapter

Fastify adapter for observability endpoints (metrics exposure).

## What this package is for

Use this package to expose operational metrics over HTTP.

Metrics are numeric signals about system health and behavior, such as request count, error count, and latency.

## Key terms (plain language)

- `observability`: ability to understand app behavior from logs/metrics/traces.
- `metrics endpoint`: HTTP route that returns current metrics snapshot.

## Public API

## `createController(deps)`

Creates controller methods.

Returned handlers:

- `getMetrics`
  - Returns metrics payload/text from observability service.
  - Real example: Prometheus scrapes `/api/metrics` every 15 seconds.

## `buildRoutes(controller, options)`

Builds route definitions for metrics endpoint(s).

Real example: Fastify registers `GET /api/metrics`.

## `schema`

Exports request/response schemas for observability routes.

Real example: route docs and runtime behavior share the same contract.

## How apps use this package (and why)

Typical flow:

1. App initializes observability core service.
2. Adapter controller wraps that service.
3. Routes are registered for monitoring tools.

Why apps use it:

- consistent metrics endpoint across apps
- less custom glue code in each server
