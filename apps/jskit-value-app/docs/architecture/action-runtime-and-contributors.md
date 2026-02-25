# Action Runtime and Contributors Deep Dive

Last updated: 2026-02-25 (UTC)

## Audience and goal

This document explains how the action runtime architecture works in `apps/jskit-value-app`, from top-level request flow down to concrete data shapes.

It is written for:

- engineers new to this codebase,
- junior developers who need a step-by-step model,
- reviewers validating architecture boundaries after the action-runtime cutover.

If you only need a quick orientation:

1. Read section "System at a glance".
2. Read section "End-to-end request flow".
3. Read section "How to add a new action".

## System at a glance

The system now has one canonical business-execution path:

1. Transport layer receives request (HTTP/assistant/internal).
2. Controller/adaptor calls `actionExecutor.execute(...)` or `actionExecutor.executeStream(...)`.
3. Execution context is normalized.
4. Action registry resolves action definition (`id` + `version`).
5. Policy pipeline enforces channel/surface/visibility, validates input, evaluates permission, applies idempotency policy, executes handler, emits audit/observability.
6. Controller maps result to transport response.

There is no business-logic bypass path in controllers for migrated capabilities.

## Package and module map

### 1) Main runtime package (core)

- Package: `@jskit-ai/action-runtime-core`
- Path: `../../packages/runtime/action-runtime-core`
- Purpose: canonical contracts + execution pipeline, independent of app-specific services.

Core files:

- `src/contracts.js`
  - action/contributor normalization and validation.
  - defines allowed domains/kinds/channels/surfaces/visibility/idempotency policies.
- `src/registry.js`
  - contributor normalization.
  - duplicate detection (`ACTION_DEFINITION_DUPLICATE`) on startup.
  - action resolution by `id` and optional `version`.
- `src/pipeline.js`
  - runtime enforcement order.
  - audit/observability hooks and structured action execution logging.
- `src/executionContext.js`
  - canonical context shape normalization.
- `src/policies.js`
  - channel/surface/visibility gates.
  - permission evaluator and schema validation integration.
- `src/idempotency.js`
  - idempotency key resolution + required-key enforcement.
- `src/audit.js`
  - noop audit adapter baseline.
- `src/observability.js`
  - noop observability adapter baseline.
- `src/index.js`
  - package exports.

### 2) App composition root for actions

- Path: `server/runtime/actions`
- Purpose: app-specific wiring (DI, adapters, contributor list, context builder).

Files:

- `index.js`
  - creates `actionRegistry` and `actionExecutor`.
- `contributorManifest.js`
  - explicit contributor imports and construction.
- `createActionRegistry.js`
  - composes registry with permission evaluator + adapters.
- `buildExecutionContext.js`
  - builds normalized action context from request and explicit overrides.
- `auditAdapters.js`, `idempotencyAdapters.js`, `observabilityAdapters.js`
  - app-specific adapter implementations.

### 3) Runtime service assembly

- Path: `server/runtime/services.js`
- Key services:
  - `actionRuntimeServices`
  - `actionRegistry`
  - `actionExecutor`

These are injected into controllers through `server/runtime/controllers.js`.

### 4) Domain-owned contributors

Contributors are domain-owned and exported from domain packages/modules.

- `auth`: `../../packages/auth/auth-provider-supabase-core/src/actions/auth.contributor.js`
- `workspace`: `../../packages/workspace/workspace-service-core/src/actions/workspace.contributor.js`
- `console`: `../../packages/workspace/workspace-console-service-core/src/actions/console.contributor.js`
- `chat`: `../../packages/chat/chat-core/src/actions/chat.contributor.js`
- `billing`: `../../packages/billing/billing-service-core/src/actions/workspaceBilling.contributor.js`
- `settings` (app-owned): `server/runtime/actions/contributors/settings.contributor.js`
- `projects` (app-owned): `server/runtime/actions/contributors/projects.contributor.js`
- `deg2rad_history` (app-owned): `server/runtime/actions/contributors/deg2radHistory.contributor.js`
- `assistant` (app-owned): `server/runtime/actions/contributors/assistant.contributor.js`
- `console errors` (app-owned): `server/runtime/actions/contributors/consoleErrors.contributor.js`
- `communications` (app-owned): `server/runtime/actions/contributors/communications.contributor.js`

### 5) Transport adapters/controllers

HTTP and assistant routes call actions via controller/adapters:

- auth adapter/controller: `../../packages/auth/auth-fastify-adapter/src/controller.js`
- workspace adapter/controller: `../../packages/workspace/workspace-fastify-adapter/src/controller.js`
- settings adapter/controller: `../../packages/workspace/settings-fastify-adapter/src/controller.js`
- console adapter/controller: `../../packages/workspace/console-fastify-adapter/src/controller.js`
- chat adapter/controller: `../../packages/chat/chat-fastify-adapter/src/controller.js`
- billing adapter/controller: `../../packages/billing/billing-fastify-adapter/src/controller.js`
- assistant adapter/controller: `../../packages/ai-agent/assistant-fastify-adapter/src/controller.js`
- app-local controllers (`projects`, `deg2rad`, `history`) under `server/modules/*/controller.js`

## Contracts in detail

### Action definition contract

An action definition (normalized in `contracts.js`) contains:

- `id`: canonical string id, for example `workspace.invite.create`.
- `version`: positive integer, current baseline is `1`.
- `domain`: one of:
  - `auth`, `settings`, `workspace`, `projects`, `chat`, `billing`, `console`, `assistant`, `deg2rad_history`.
- `kind`: `query`, `command`, `stream`.
- `channels`: allowlist of:
  - `api`, `assistant_tool`, `assistant_chat`, `internal`, `worker`.
- `surfaces`: allowlist of:
  - `app`, `admin`, `console`.
- `visibility`: `public`, `internal`, `operator`.
- `inputSchema`: required schema contract (`parse`, `validate`, `assert`, `check`, or function).
- `outputSchema`: optional schema contract for normalized output validation.
- `permission`: static permission list or dynamic function.
- `idempotency`: `none`, `optional`, `required`, `domain_native`.
- `audit`: `{ actionName, metadataBuilder?, piiTags[] }`.
- `observability`: `{ metricTags[], sampleRate? }`.
- `assistantTool`: optional `{ description, inputJsonSchema }` for tool publishing.
- `execute(input, context, deps)`: handler function.

### Contributor contract

A contributor is normalized as:

- `contributorId`: stable unique string.
- `domain`: must match allowed domains.
- `actions`: array of action definitions.

If malformed, startup fails.
If duplicate action id+version is found across contributors, startup fails.

### Registry contract

`createActionRegistry(...)` returns:

- `execute({ actionId, version?, input, context, deps })`
- `executeStream({ actionId, version?, input, context, deps })`
- `listDefinitions()`
- `getDefinition(actionId, version?)`

Resolution behavior:

- without version: highest available version for `actionId`.
- with version: exact `actionId@v<version>`.

### Execution context contract

Normalized context shape:

- `actor`: `{ id, email, roleId, isOperator } | null`
- `workspace`: `{ id, slug, name } | null`
- `membership`: `{ roleId, status } | null`
- `permissions`: normalized unique permission array
- `surface`: lowercase, defaults to `app`
- `channel`: lowercase, defaults to `internal`
- `requestMeta`:
  - `requestId`
  - `commandId`
  - `idempotencyKey`
  - `ip`
  - `userAgent`
  - `request` (raw request reference, for transport-level access)
- `assistantMeta`:
  - `conversationId`
  - `toolCallId`
  - `provider`
  - `turnId`
- `timeMeta`:
  - `now`
  - `timezone`
  - `locale`

Example:

```json
{
  "actor": { "id": 42, "email": "owner@example.com", "roleId": "admin", "isOperator": false },
  "workspace": { "id": 17, "slug": "acme", "name": "Acme" },
  "membership": { "roleId": "admin", "status": "active" },
  "permissions": ["workspace.settings.update", "workspace.members.view"],
  "surface": "admin",
  "channel": "api",
  "requestMeta": {
    "requestId": "req_123",
    "commandId": "cmd_123",
    "idempotencyKey": "idem_123",
    "ip": "203.0.113.5",
    "userAgent": "Mozilla/5.0"
  },
  "assistantMeta": {
    "conversationId": "71",
    "toolCallId": "call_1",
    "provider": "openai",
    "turnId": "turn_12"
  },
  "timeMeta": { "now": "2026-02-25T14:30:00.000Z", "timezone": "UTC", "locale": "en-US" }
}
```

## End-to-end request flow

### Flow A: normal API command (`channel=api`)

Example route intent: update workspace settings.

1. HTTP route handler calls controller method.
2. Controller calls:
   - `actionExecutor.execute({ actionId: "workspace.settings.update", context: { request, channel: "api" }, input })`
3. `buildExecutionContext(...)` resolves:
   - actor/workspace/permissions from request,
   - surface from explicit context, request, header, or pathname.
4. Registry resolves definition.
5. Pipeline enforces gates:
   - channel allowed,
   - surface allowed,
   - visibility allowed (`operator` gate).
6. Pipeline validates input using action `inputSchema`.
7. Pipeline evaluates permission policy.
8. Pipeline resolves idempotency key and checks required policy.
9. Pipeline calls action handler.
10. Pipeline validates output (if `outputSchema` exists).
11. Pipeline emits audit and observability hooks.
12. Controller returns HTTP response.

### Flow B: assistant chat streaming (`channel=assistant_chat`)

1. Assistant stream route controller calls `actionExecutor.executeStream(...)` with action `assistant.chat.stream`.
2. Assistant service resolves surface and tool catalog for that surface.
3. Tool catalog is derived from action definitions (`channel=assistant_tool`, matching `surface`).
4. During tool call execution, tool runtime executes canonical action through `actionExecutor.execute(...)` with `channel=assistant_tool`.
5. Tool result is fed back into model turn stream.

No separate legacy tool handler path is used.

## Pipeline order and behavior

The action pipeline order is:

1. normalize context
2. channel gate
3. surface gate
4. visibility gate
5. input schema normalization/validation
6. permission evaluation
7. idempotency key resolution and required-key enforcement
8. claim/replay handling (adapter)
9. handler execution
10. output validation (optional)
11. idempotency success/failure callbacks
12. observability callbacks
13. audit emission
14. structured action log (`action.execution`)

Key outcomes:

- permission deny -> `403` (`ACTION_PERMISSION_DENIED` by default).
- invalid input -> `400` (`ACTION_VALIDATION_FAILED`).
- unknown action -> `404` (`ACTION_NOT_FOUND`).
- wrong stream kind via `executeStream` -> `400` (`ACTION_STREAM_KIND_REQUIRED`).

## Surface and channel isolation model

Isolation is enforced at multiple levels.

### 1) Definition-level allowlists

Every action explicitly defines allowed `channels` and `surfaces`.

If the current execution context is not in allowlist, pipeline fails with `403`.

### 2) Assistant tool catalog filtering

`server/modules/ai/lib/tools/actionTools.js` filters candidate actions by:

- `channels` includes `assistant_tool`
- `surfaces` includes current surface
- `kind` is not `stream`
- `visibility` is not `operator`
- assistant exposure config (`enabled`, `exposedActionIds`, `blockedActionIds`)

Result: tool definitions outside current surface are not present in provider tool schema list.

### 3) Conversation surface scoping for transcripts

Transcript conversations store surface in metadata (`metadata.surfaceId`).

Assistant transcript services enforce surface match on:

- conversation resume,
- list queries,
- message reads,
- export queries.

Cross-surface access fails closed with `404 Conversation not found`.

## Permissions model

An action permission can be:

- static array of required permissions:
  - example: `["workspace.members.view"]`
- dynamic resolver function:
  - receives `(context, input)`,
  - returns boolean or `{ allowed, reason, code }`.

`createPermissionEvaluator(...)` evaluates these policies centrally in the pipeline.

Route-level auth metadata remains defense-in-depth, but action policy is authoritative for action execution.

## Validation strategy

Validation occurs in action pipeline, not controller business logic.

Supported schema styles:

- function schema,
- object with `parse(...)`,
- object with `validate(...)`,
- object with `assert(...)`,
- object with `check(...)`.

Input validation failures become:

- `ACTION_VALIDATION_FAILED` (status 400),
- with optional `details.fieldErrors`.

Output validation is optional per action. If configured and failing:

- `ACTION_OUTPUT_VALIDATION_FAILED` (status 500).

## Idempotency strategy (current state)

Runtime contract supports:

- `none`
- `optional`
- `required`
- `domain_native`

Current app adapter (`server/runtime/actions/idempotencyAdapters.js`) is still a noop adapter bridge.
That means:

- idempotency policy and key enforcement are active for `required`,
- persistent claim/replay behavior is not yet connected in app adapter implementation.

Assistant tool invocations still generate deterministic per-tool-call idempotency keys in tool runtime context.

## Audit strategy

Audit events are emitted from action pipeline via app audit adapter:

- adapter file: `server/runtime/actions/auditAdapters.js`
- transport-level request data comes from `requestMeta.request` when available,
- fallback actor/surface metadata comes from normalized execution context.

Audit metadata includes:

- `actionId`
- `actionVersion`
- `channel`
- `durationMs`
- `idempotencyReplay`
- optional normalized error payload

Per-action custom metadata can be added with `audit.metadataBuilder`.

## Observability strategy (current state)

Action pipeline always calls observability adapter hooks:

- execution start
- execution finish
- authorization denied
- validation failure
- idempotent replay

App adapter forwards to optional observability service methods if present.

Current `@jskit-ai/observability-core` metrics registry has mature HTTP/auth/audit/AI metrics, but does not currently expose dedicated action-runtime metric methods. So action observability forwarding is currently hook-ready and safe, with structured logs and audit still active.

## Data examples

### 1) Action definition example (trimmed)

```js
{
  id: "workspace.invite.create",
  version: 1,
  domain: "workspace",
  kind: "command",
  channels: ["api", "assistant_tool", "internal"],
  surfaces: ["admin"],
  visibility: "public",
  inputSchema: OBJECT_INPUT_SCHEMA,
  permission: ["workspace.members.invite"],
  idempotency: "optional",
  audit: { actionName: "workspace.invite.create" },
  observability: {},
  assistantTool: {
    description: "Invite a user to the workspace.",
    inputJsonSchema: { type: "object", required: ["email", "roleId"] }
  },
  async execute(input, context) { ... }
}
```

### 2) Assistant tool execution context example

```json
{
  "channel": "assistant_tool",
  "surface": "admin",
  "assistantMeta": {
    "conversationId": "71",
    "toolCallId": "call_abc",
    "provider": "openai",
    "turnId": "turn_6",
    "toolName": "workspace_invite_create",
    "actionId": "workspace.invite.create"
  },
  "requestMeta": {
    "idempotencyKey": "assist:71:call_abc:..."
  }
}
```

### 3) Structured action execution log shape

```json
{
  "action": "workspace.invite.create",
  "version": 1,
  "channel": "assistant_tool",
  "surface": "admin",
  "requestId": "req_123",
  "durationMs": 48,
  "outcome": "success",
  "errorCode": null,
  "idempotencyReplay": false
}
```

## Assistant-specific behavior

Assistant functionality is split into two action layers:

1. orchestration actions (`assistant.chat.stream`, `assistant.conversations.list`, `assistant.conversation.messages.list`, `assistant.stream.cancel`, `assistant.conversation.start_new`)
2. business actions callable as tools (`channel=assistant_tool` in domain contributors)

Tool names are deterministic and provider-safe:

- generated from canonical action id,
- normalized to tool naming constraints,
- collision-safe with hash suffixing.

Tool execution always routes back through action pipeline.

## Configuration touchpoints

### `config/actions.js`

Current policy knobs:

- `actions.assistant.enabled`
- `actions.assistant.exposedActionIds`
- `actions.assistant.blockedActionIds`
- `actions.internal.enabled`
- `actions.internal.exposedActionIds`
- `actions.internal.blockedActionIds`

### `shared/actionIds.js`

Canonical action id constants used across adapters/controllers/tests.

## Testing state

Current action-runtime integration coverage includes:

- `tests/actionRegistry.test.js`
  - runtime scaffold validation
  - action registry and executor availability
  - presence checks for high-value actions
  - assistant-tool channel metadata checks on selected actions

Assistant-focused coverage includes:

- `tests/aiToolsWorkspaceRename.test.js`
- `tests/aiService.test.js`
- `tests/aiTranscriptsService.test.js`

These verify:

- tool catalog derivation from action definitions,
- surface filtering,
- transcript surface scoping and fail-closed behavior.

## How to add a new action (practical checklist)

1. Pick owning contributor:
   - domain package if domain-owned,
   - app contributor if app-local domain.
2. Add definition:
   - canonical `id`,
   - explicit `channels` and `surfaces`,
   - `inputSchema`,
   - permission policy,
   - idempotency policy.
3. Implement handler using injected services.
4. If assistant-callable:
   - include `assistant_tool` in channels,
   - add optional `assistantTool` metadata (`description`, `inputJsonSchema`).
5. Ensure action id is in `shared/actionIds.js`.
6. Call action from adapter/controller via `actionExecutor`.
7. Add/update tests.

## Troubleshooting guide

### `ACTION_NOT_FOUND`

Common causes:

- wrong action id string,
- contributor not mounted in manifest,
- version mismatch.

Checks:

- inspect `actionExecutor.listDefinitions()`,
- verify `server/runtime/actions/contributorManifest.js`.

### `ACTION_SURFACE_FORBIDDEN` or `ACTION_CHANNEL_FORBIDDEN`

Common causes:

- mismatched `context.surface` or `context.channel`,
- action definition missing expected surface/channel.

Checks:

- inspect request headers/path for resolved surface,
- inspect action definition allowlists.

### `ACTION_VALIDATION_FAILED`

Common causes:

- schema parse/validate rejection,
- missing required payload fields.

Checks:

- inspect returned `details.fieldErrors`,
- compare controller payload mapping against action `inputSchema`.

### `ACTION_IDEMPOTENCY_KEY_REQUIRED`

Cause:

- action marked `idempotency: "required"` and no key in `requestMeta.idempotencyKey` or command id fallback.

Checks:

- ensure client sets idempotency header or command id for that route.

## Important boundaries and non-goals

- Controllers/adapters own transport concerns (status codes, redirects, cookies, stream framing).
- Actions own business policy and business side effects.
- Route policy metadata remains useful defense-in-depth, but does not replace action policy.
- No auto-discovery contributor registration; composition is explicit.

