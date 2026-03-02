# @jskit-ai/communications-provider-core

Provider contracts and channel normalization helpers for communications services.

## What this package is for

Use this package to standardize how SMS/email provider adapters behave.

It defines:

- allowed communication channels
- normalized provider result reasons
- validation helpers for provider objects

## Key terms (plain language)

- `provider`: external service that actually sends a message (for example Twilio, SES).
- `channel`: delivery type, such as `sms` or `email`.
- `normalize`: convert many possible input formats into one consistent format.

## Public API

- `COMMUNICATION_CHANNELS`
  - Enum-like constants of supported channels.
  - Real example: orchestration layer checks if requested channel is supported.
- `COMMUNICATION_PROVIDER_RESULT_REASONS`
  - Standard reason codes for delivery outcomes.
  - Real example: map provider-specific failure text to a shared reason like `rejected`.
- `normalizeChannel(value)`
  - Converts raw channel input into canonical channel value.
  - Real example: user input `SMS`, `Sms`, and `sms` all normalize to `sms`.
- `assertDispatchProvider(provider)`
  - Validates that a provider implementation exposes required dispatch behavior.
  - Real example: fail fast on startup if provider adapter is missing `send` method.

## How apps use this package (and why)

Typical flow:

1. App builds provider adapter.
2. Core communications service calls `assertDispatchProvider` during initialization.
3. Incoming channel values pass through `normalizeChannel`.
4. Delivery outcomes use shared reason constants.

Why apps use it:

- keeps multi-provider integrations consistent
- reduces edge-case bugs caused by inconsistent channel strings
