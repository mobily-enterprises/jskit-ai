# `@jskit-ai/assistant-transcripts-core`

## What This Package Is For

`@jskit-ai/assistant-transcripts-core` manages transcript policy and transcript persistence behavior.

It provides:

1. Transcript mode rules (`standard`, `restricted`, `disabled`).
2. Secret redaction helpers.
3. Transcript service methods for listing, reading, and exporting conversation records.

## Why Apps Use It

In `apps/jskit-value-app`, assistant and admin transcript wrappers use this package so transcript behavior is consistent while permission vocabulary remains app-local.

## Public API

## Mode API

### Constants

- `TRANSCRIPT_MODE_STANDARD`
- `TRANSCRIPT_MODE_RESTRICTED`
- `TRANSCRIPT_MODE_DISABLED`
- `TRANSCRIPT_MODE_VALUES`

What they mean:

1. `standard`: store message content normally.
2. `restricted`: store metadata plus redacted/safe content handling.
3. `disabled`: do not persist transcript content for turns.

### `normalizeTranscriptMode(value, fallback)`

- Validates/normalizes mode string.

Example:

```js
normalizeTranscriptMode(" RESTRICTED ");
// "restricted"
```

### `resolveTranscriptModeFromWorkspaceSettings(workspaceSettings)`

- Reads transcript mode from workspace settings feature object.

Example:

- Workspace config toggles to `disabled`; service stops transcript persistence.

### `applyTranscriptModeToWorkspaceFeatures(features, transcriptMode)`

- Returns updated feature object with normalized mode.

Example:

- Admin saves workspace AI policy and this helper writes normalized mode back.

## Redaction API

### `REDACTION_VERSION`

- Current redaction algorithm version marker.

### `redactSecrets(value)`

What it does:

- Redacts common secret/token patterns from text.
- Returns:
  - redacted text
  - whether redaction happened
  - hit types/count
  - redaction version

Practical example:

- User accidentally includes bearer token in prompt; transcript stores `[REDACTED]`.

## Transcript Service API

## `createAssistantTranscriptsService(options)`

What it does:

- Creates transcript service with injected repositories/permission helpers.

Returned methods and practical examples:

1. `resolveWorkspaceTranscriptMode(workspace)`
   - Determines active transcript mode for workspace.
   - Example: before each turn, resolve whether transcripts are enabled.
2. `startConversationForTurn(workspace, user, metadata)`
   - Starts or resumes transcript conversation for an assistant turn.
   - Example: first message in a session creates conversation row.
3. `updateConversationTitle(workspace, conversationId, title)`
   - Updates transcript conversation title.
   - Example: assistant-generated title after first meaningful turn.
4. `appendMessage(workspace, conversationId, payload)`
   - Appends transcript message entry (chat/tool/error).
   - Example: store `tool_result` event row.
5. `completeConversation(workspace, conversationId, status, metadata)`
   - Marks conversation complete/failed/aborted.
   - Example: stream aborted -> status `aborted`.
6. `listWorkspaceConversations(workspace, query)`
   - Workspace-wide transcript list (admin/system perspective).
   - Example: admin console transcript table.
7. `listWorkspaceConversationsForUser(workspace, user, query)`
   - User-scoped transcript list.
   - Example: app user views only own assistant sessions.
8. `getWorkspaceConversationMessages(workspace, conversationId, query)`
   - Workspace-wide message read.
   - Example: admin opens conversation detail.
9. `getWorkspaceConversationMessagesForUser(workspace, user, conversationId, query)`
   - User-scoped message read.
   - Example: user opens own transcript detail.
10. `exportWorkspaceConversation(workspace, conversationId, query)`
    - Export one conversation in selected format.
    - Example: export a specific session for support review.
11. `listConsoleConversations(workspace, query)`
    - Console-oriented listing with permission checks.
    - Example: operations team filtering by status/date.
12. `getConsoleConversationMessages(workspace, conversationId, query)`
    - Console-oriented message retrieval.
    - Example: inspect exact turn history for incident.
13. `exportConsoleMessages(workspace, query)`
    - Console export across filter set.
    - Example: compliance export for date range.

Why apps use this API:

- Keeps transcript logic consistent and auditable while app controls role/permission vocabulary.

## Testing Hooks

- `assistantTranscriptsServiceTestables`
- `redactSecretsTestables`

These expose internal helpers for deterministic unit tests.

## How It Is Used In Real App Flow

1. Assistant core starts a turn and asks transcript service for mode/conversation.
2. During stream, assistant core appends transcript rows.
3. On completion/failure, assistant core finalizes conversation status.
4. App/admin UIs query lists/messages through wrappers backed by this package.

This package is the shared policy and persistence layer for transcript behavior.
