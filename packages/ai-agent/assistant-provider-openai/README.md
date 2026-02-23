# `@jskit-ai/assistant-provider-openai`

## What This Package Is For

`@jskit-ai/assistant-provider-openai` is the OpenAI provider adapter used by assistant core.

It wraps OpenAI SDK usage behind a small provider contract so orchestration code can stay provider-agnostic.

## Why Apps Use It

In `apps/jskit-value-app`, a wrapper injects app `AppError` behavior and configuration values, then passes this provider to `@jskit-ai/assistant-core`.

This keeps provider SDK details out of business orchestration.

## Public API

## `createOpenAiClient(options)`

What it does:

- Creates a provider client object with either:
  1. disabled behavior (throws `404 Not found` style errors), or
  2. enabled OpenAI-backed behavior.

Supported options:

1. `enabled`
2. `provider` (must be `openai`)
3. `apiKey`
4. `baseUrl` (optional)
5. `timeoutMs`
6. `appErrorClass` (optional override)

Returned provider methods:

### `createChatCompletion({ model, messages, temperature })`

- Non-streaming completion.

Practical example:

- Generate a short conversation title from first user turn.

### `createChatCompletionStream({ model, messages, tools, signal, temperature })`

- Streaming chat completion.

Practical example:

- Main assistant response stream where UI receives token deltas and tool calls.

### `enabled` and `provider`

- Runtime metadata used by orchestration layer.

Practical example:

- Core checks `enabled` before accepting stream requests.

## `assistantProviderOpenAiTestables`

What it does:

- Exposes test-only internals (`DefaultAppError`, disabled-provider factory).

Practical example:

- Unit test validates disabled provider returns deterministic 404 behavior.

## How It Is Used In Real App Flow

1. App loads AI config and creates OpenAI provider via `createOpenAiClient(...)`.
2. App injects provider into `createAssistantService(...)`.
3. Assistant core uses streaming method for normal turns and non-streaming method for helper operations (for example title generation).

This package isolates OpenAI SDK concerns from the rest of assistant architecture.
