# @jskit-ai/communications-fastify-adapter

Fastify adapter for communications endpoints.

## What this package is for

Use this package to expose communication actions over HTTP.

This adapter currently wires handlers such as sending SMS (and can be extended for email endpoints).

## Key terms (plain language)

- `adapter`: boundary layer connecting HTTP requests to domain services.
- `controller`: request handler methods.
- `route`: URL + HTTP method mapping (for example `POST /api/workspace/sms/send`).

## Public API

## `createController(deps)`

Creates HTTP handlers.

Returned handlers:

- `sendSms`
  - Sends an SMS through the configured communications service.
  - Real example: send OTP code to user phone during login verification.
- `sendEmail`
  - Sends an email through the configured communications service.
  - Real example: send account invite email after admin creates an invite.

## `buildRoutes(controller, options)`

Returns route definitions that map HTTP endpoints to the controller methods.

Real example: app registers this route set so `POST /api/workspace/sms/send` calls `controller.sendSms`.

Why apps use it:

- avoids re-implementing endpoint wiring in each app
- keeps route behavior consistent between services/environments

## How apps use this package (and why)

Typical flow:

1. App creates `communicationsService`.
2. App calls `createController({ communicationsService, ... })`.
3. App registers `buildRoutes(controller)` with Fastify.

Why this separation helps:

- communication logic remains reusable and testable in core package
- HTTP behavior stays thin and predictable
