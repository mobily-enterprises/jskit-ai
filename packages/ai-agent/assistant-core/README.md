# `@jskit-ai/assistant-core`

## What This Package Is For

`@jskit-ai/assistant-core` is the shared server-side orchestration engine for assistant chat turns.

It handles:

1. Input normalization and validation.
2. Prompt assembly.
3. Provider streaming orchestration.
4. Tool-call loop execution.
5. Error mapping/audit/transcript hooks.

It also provides generic tool-registry mechanics.

## Why Apps Use It

In `apps/jskit-value-app`, app composition injects app-owned behavior (permissions, prompt sources, route/surface mapping, realtime constants, and action-derived tool catalog) into this package.

That means:

1. Shared orchestration stays reusable.
2. Product-specific policy remains app-local.

## Public API

## `createAssistantService(options)`

What it does:

- Creates the assistant turn service.
- Requires injected `providerClient` + `auditService`.
- Accepts optional transcript/realtime/settings dependencies.

Typical injected dependencies:

1. `providerClient` with streaming completion methods.
2. `workspaceSettingsRepository` and `consoleSettingsRepository`.
3. `aiTranscriptsService`.
4. `realtimeEventsService`.
5. `hasPermissionFn`.
6. app-local action-derived tool descriptors.

Returned methods:

### `isEnabled()`

- Returns whether provider is enabled.

Practical example:

- Controller returns 404 for assistant endpoints when provider disabled.

### `validateChatTurnInput({ body })`

- Validates and normalizes incoming turn payload:
  - `messageId`
  - `conversationId`
  - `input`
  - `history`
  - `clientContext`

Practical example:

- Reject oversized prompt before opening stream.

### `streamChatTurn({ request, body, streamWriter, abortSignal, validatedInput })`

- Full turn lifecycle:
  1. Resolves surface/tool allowlist.
  2. Builds system/user/provider messages.
  3. Streams assistant deltas.
  4. Executes tool calls when model requests them.
  5. Emits stream events (`meta`, `assistant_delta`, `tool_call`, `tool_result`, `done`/`error`).
  6. Writes transcript and audit records through injected services.

Practical example:

- User asks "Update workspace name to ACME".
- Assistant calls `workspace_settings_update` tool.
- Tool result is streamed.
- Assistant final response is streamed and persisted.

Why apps use this API:

- Keeps orchestration rules in one place while letting each app control tool/policy surface.

## `systemPrompt` helpers (`@jskit-ai/assistant-core/systemPrompt`)

Shared assistant system-prompt utilities used by assistant, workspace, and console flows:

- `AI_ASSISTANT_SYSTEM_PROMPT_MAX_LENGTH`
- `normalizePromptValue(value)`
- `resolveAssistantSystemPromptAppFromWorkspaceSettings(workspaceSettings)`
- `resolveAssistantSystemPromptWorkspaceFromConsoleSettings(consoleSettings)`
- `resolveAssistantSystemPromptsFromWorkspaceSettings(workspaceSettings)`
- `applyAssistantSystemPromptAppToWorkspaceFeatures(features, promptValue)`
- `applyAssistantSystemPromptsToWorkspaceFeatures(features, promptPatch)`
- `applyAssistantSystemPromptWorkspaceToConsoleFeatures(features, promptValue)`

## Tool Registry API

## `buildAiToolRegistry({ tools })`

What it does:

- Builds normalized registry object from tool descriptors.
- Ignores invalid descriptors (missing name or execute fn).

Practical example:

- App passes action-derived descriptors to create fast lookup by tool name.

## `listToolSchemas(registry)`

What it does:

- Converts registry entries into provider-compatible tool schema list.

Practical example:

- Send returned schema array as `tools` in OpenAI chat completion request.

## `executeToolCall(registry, { name, args, context, appErrorClass, hasPermissionFn })`

What it does:

- Executes one tool by name.
- Validates required permissions before execution.
- Throws normalized errors for unknown/forbidden tools.

Practical example:

- Assistant requests a blocked tool; permission check fails -> throws 403 `AI_TOOL_FORBIDDEN`.

Why apps use tool APIs:

- Tool execution policy is explicit and testable, not hidden inside provider logic.

## Testing Hooks

- `assistantServiceTestables`
- `assistantToolRegistryTestables`

These are test-focused internals and not intended as stable app runtime surface.

## How It Is Used In Real App Flow

1. Fastify adapter receives stream request.
2. Controller calls `validateChatTurnInput(...)`.
3. Controller creates stream writer and calls `streamChatTurn(...)`.
4. Core emits stream events and tool results.
5. Client runtime consumes those events and updates UI state.

This package is the shared brain of assistant turn execution.
