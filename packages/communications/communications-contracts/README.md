# @jskit-ai/communications-contracts

Shared request/response schemas for communications APIs.

## What this package is for

Use this package to define and reuse API contracts for communication actions like sending SMS and email.

A contract is the exact shape of data an endpoint accepts and returns.

## Key terms (plain language)

- `schema`: a machine-checkable definition of valid payload fields.
- `contract`: agreed request/response structure between frontend and backend.
- `validation`: automatic rejection of malformed input.

## Public API

## `schema`

Exports schema objects for communications endpoints.

Practical examples:

- SMS send payload schema validates fields like destination number and message body.
- Email send payload schema validates fields like recipient, subject, and content.
- Response schema standardizes delivery outcome fields.

Why apps use it:

- frontend and backend share one source of truth
- OpenAPI/docs and runtime validation stay in sync
- fewer integration bugs caused by payload drift

## How apps use this package (and why)

Typical flow:

1. Fastify adapter imports `schema` and attaches it to routes.
2. Invalid requests are rejected before business logic runs.
3. Frontend clients can rely on stable response shapes.

Why this matters:

- safer refactors
- easier onboarding for teams new to the codebase
