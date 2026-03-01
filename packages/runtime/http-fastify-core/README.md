# @jskit-ai/http-fastify-core

Laravel-style HTTP routing facade for Fastify in JSKIT.

## What this package does

- Provides an in-memory router facade (`get/post/...`, `group`, `resource`, `apiResource`).
- Registers route definitions into Fastify with deterministic middleware execution.
- Exposes a small runtime adapter that wires router + Fastify via container tokens.
