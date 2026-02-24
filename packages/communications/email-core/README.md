# @jskit-ai/email-core

Core email service interface for JSKit communications.

## What this package is for

Use this package as the email-domain service boundary. It gives a consistent method shape for sending email, even if the actual provider changes later.

## Key terms (plain language)

- `service boundary`: the API your app calls, regardless of internal implementation.
- `provider`: the vendor that sends email (SES, SendGrid, Resend, etc.).

## Public API

## `createService(deps)`

Creates email service.

Returned methods:

- `sendEmail(payload)`
  - Attempts to send an email using the configured provider flow.
  - Real example: send workspace invite with link and expiration details.

The service currently exposes normalized behavior and metadata for integration points, and can return "not implemented" style outcomes if provider wiring is not enabled yet.

## `__testables`

Internal helpers exported for unit testing.

Real example: tests assert that invalid payloads are rejected consistently.

## How apps use this package (and why)

Typical flow:

1. App creates email service at startup.
2. Workspace/auth/billing flows call `sendEmail` for notifications.
3. App can swap provider integration without changing calling code.

Why apps use it:

- stable interface for email in all domain flows
- cleaner provider migration path
