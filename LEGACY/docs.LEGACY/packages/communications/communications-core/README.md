# @jskit-ai/communications-core

Core orchestration service for sending communications (SMS and email) across direct services or pluggable providers.

## What this package is for

Use this package to centralize message dispatch rules.

It gives one place to decide:

- which channel to use (`sms` or `email`)
- whether to use a custom provider adapter or fallback core service
- how dispatch metadata is normalized

## Key terms (plain language)

- `orchestrator`: code that decides where a request should go.
- `dispatch`: attempt to send a message through a provider/service.
- `metadata`: extra key/value information attached to a message (for audit, tracing, use case tags).

## Public API

## `createService({ smsService, emailService, providers, onDispatch })`

Creates the high-level communications service.

Returned methods:

- `sendSms(payload)`
  - Sends an SMS by routing through the orchestrator.
  - Real example: send a one-time login code to `+1...`.
- `sendEmail(payload)`
  - Sends an email by routing through the orchestrator.
  - Real example: send workspace invite email with accept link.
- `dispatchByUseCase({ channel, payload, metadata })`
  - Generic dispatch method used when caller chooses channel at runtime.
  - Real example: notification engine decides channel per user preference.

Why apps use it:

- one API for all communication flows
- channel routing logic is centralized

## `createOrchestrator({ smsService, emailService, providers, onDispatch })`

Creates a lower-level orchestrator.

Returned methods:

- `dispatchByUseCase({ channel, payload, metadata })`
  - Resolves provider for a channel and dispatches.
  - Real example: if custom SMS provider exists, use it; otherwise fallback to `smsService.sendSms`.

Behavior in simple terms:

1. Normalize channel string.
2. Check registry for provider for that channel.
3. If provider exists, call `provider.dispatch(...)`.
4. Else fallback to built-in channel service (`smsService`/`emailService`).
5. Call `onDispatch` hook when provided.

## `createDispatchRegistry({ providers })`

Creates an in-memory lookup of providers by channel.

Returned methods:

- `hasChannel(channel)`
  - Returns whether a provider is registered for channel.
  - Real example: startup check for whether custom email provider is configured.
- `resolveProvider(channel)`
  - Returns provider object or `null`.
  - Real example: orchestrator resolves provider before dispatching.

## How apps use this package (and why)

Typical flow:

1. App builds `smsService` and optionally `emailService`.
2. App passes any custom providers (`[{ channel: 'sms', dispatch(...) }, ...]`).
3. Domain features call `communicationsService.sendSms/sendEmail`.

Why apps use it:

- consistent dispatch behavior across features
- easy to add/replace providers without changing callers
