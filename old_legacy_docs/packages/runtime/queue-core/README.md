# @jskit-ai/queue-core

Worker and job runtime primitives for JSKIT.

## What this package does

- Registers job handlers by deterministic job IDs.
- Dispatches jobs to an in-memory queue.
- Runs queued jobs through a controllable worker lifecycle (`start`, `drain`, `stop`).
