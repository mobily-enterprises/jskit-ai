# @jskit-ai/redis-ops-core

Shared Redis runtime primitives for JSKit apps:

- Redis namespace/key builders
- Fastify rate-limit Redis wiring helpers
- BullMQ worker queue/runtime helpers
- Distributed lock primitives and Redis connection helpers

App repositories should keep only thin wiring/adapters and inject app-specific services/policies.
