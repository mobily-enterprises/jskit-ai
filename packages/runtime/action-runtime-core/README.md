# @jskit-ai/action-runtime-core

Canonical action execution runtime for JSKit server business operations.

This package provides:

- Action definition and contributor contracts.
- Central action registry and execution pipeline.
- Shared execution context normalization.
- Policy hooks for permission, idempotency, audit, and observability.

Design intent:

- One server-side business execution path for all channels.
- No route/controller bypass APIs.
- App composition remains explicit through contributor manifests.
