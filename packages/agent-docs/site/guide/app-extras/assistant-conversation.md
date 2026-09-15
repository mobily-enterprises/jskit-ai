# Embeddable assistant conversations

`@jskit-ai/assistant-core` supplies a Vue/Vuetify conversation element, transcript
policy, and native provider primitives. It has no dependency on an editor,
project directory, application database, identity scheme, or avatar.

Use this contract when the application already owns its conversation endpoints
or needs custom storage and provider execution. Applications using the complete
JSKIT assistant surface use [Assistant](./assistant.md), which
owns its routes, database repositories, action-tool loop, and settings.
Both integrations render the same `AssistantConversationElement`. Choose one transcript owner for a conversation.

## Ownership

| JSKIT owns | The application supplies |
| --- | --- |
| Bubbles, rich text, reasoning groups, long-message expansion, scroll following, composer, delivery controls | Conversation selection, labels, loading/errors, current draft and action implementations |
| Turn grouping, message deduplication, final-answer replacement and history pagination | Storage adapter, authorized scope, transaction/locking implementation, retention, migrations and attachment bytes |
| Codex JSON-RPC and notification classification, detached-turn completion/recovery, OpenCode HTTP/SSE | Provider process/connection, account credentials, execution environment, permissions, tools, model policy and reconnect ownership |
| Display of supplied configuration and optional editing controls | Authoritative configuration, permitted changes and server validation |

No global store or router is installed by the element. Multiple assistants can
coexist with separate adapters. The application mounts it in a pane with a
definite height and `min-height: 0`. The composer does not shrink under transcript
pressure. Bubbles use the application's Vuetify theme colors.

## Client contract

```js
import { AssistantConversationElement } from "@jskit-ai/assistant-core/client/conversation";

const adapter = reactive({
  conversation: {
    turns, visible: true, loading, error, scrollKey: conversationId,
    assistantLabel: "Assistant", hasMoreBefore, loadingMore, loadMoreError
  },
  composer: {
    draft, disabled, canSend, pending, canStop, stopDisabled, stopPending,
    placeholder: "Ask a question…", submitLabel: "Send"
  },
  actions: {
    setDraft, submit, stop, loadMore, reload, resend, cancel, edit, openLink,
    updateConfiguration
  }
});
```

Use reactive values or replace the adapter when state changes. Ordinary nested
objects containing refs must be wrapped in `reactive()` so their fields unwrap.
Only `conversation` is required; omit `composer` for a transcript-only view.
Missing optional actions are ignored. Supply `setDraft` and `submit` when a
composer is present, and `stop` when `canStop` can become true.

| Action | Arguments and responsibility |
| --- | --- |
| `setDraft(text)` | Update the application draft synchronously. |
| `submit({ configuration })` | Send or steer through the app's normal admission, attachment and delivery path. Own pending state, accepted-draft clearing and visible failures. The element checks `canSend` before calling. |
| `stop()` | Request cancellation through the backend owner. Report pending state, errors, and what actually stopped; the element checks stop availability. |
| `loadMore({ complete })` | Prepend older turns, then call `complete({ changed })` after updating reactive state. Call it on failures too; this releases the scroll anchor. |
| `reload()` | Refresh authoritative history. |
| `resend(id)`, `cancel(id)`, `edit(id)` | Handle a failed optimistic turn using its stable `optimistic.id`. Retry according to server delivery evidence. |
| `openLink({ event, href, text })` | Optionally handle app-owned links and call `event.preventDefault()`. Otherwise a validated ordinary link keeps normal browser behavior. |
| `updateConfiguration(value)` | Accept an edited draft configuration; the server remains authoritative. |

`scrollKey` changes when conversation ownership changes, resetting scroll and
expansion state. `followLatestKey` requests following the newest message.
`reloadable`, `reloading`, `welcomeMessage`, and `variant: "main" | "task"`
control the corresponding transcript presentation. `userMessageFormat` is
`"formatted"` by default; `"plain"` preserves literal user-authored text.

### Turns and messages

```js
{
  turnId: "stable-app-turn-id",
  user: { messageId: "request-id", role: "user", text: "Hello", at: "2026-01-01T00:00:00Z", attachments: [] },
  assistant: { messageId: "reply-id", role: "assistant", text: "Hello back", at: "2026-01-01T00:00:01Z" },
  messages: [/* ordered user, thinking, commentary and assistant messages */],
  pending: false,
  metadata: { /* application data */ }
}
```

`system` is an optional status message. Without `messages`, the transcript uses
the turn's `thinking`, `commentary`, and `assistant` fields. Keep IDs stable across
updates and pagination. The UI never uses provider-internal turn IDs to decide
application ownership. An optimistic turn can carry
`optimistic: { id, status: "failed", error }`.

For an existing flat history, import `conversationTurnsFromMessages` from
`@jskit-ai/assistant-core/shared/conversation`. It groups ordered messages,
retains application fields, converts `progressUpdates` into reasoning, and
recognizes `starting`, `inProgress`, `interrupted`, and `failed` statuses.
Messages require `text`; applications map names such as `content` explicitly.

### Configuration and slots

```vue
<AssistantConversationElement
  :adapter="adapter"
  :configuration="configuration"
  configuration-mode="hidden"
/>
```

`hidden` hides configuration controls while still passing the supplied object to
`submit`. `readonly` displays disabled controls. `editable` calls
`updateConfiguration`. `configurationFields` supplies optional select fields:
`[{ name, label, items }]`. The `configuration` slot can replace those controls;
it receives `{ configuration, disabled, update }`. Pending sends disable edits.
Hiding or disabling controls does **not** authorize backend configuration. The
server must choose or validate model, tool and permission settings itself.

Other slots:

| Slot | Scope / use |
| --- | --- |
| `welcome` | Application welcome content and suggested requests, shown when `welcomeMessage` is nonempty |
| `attachments` | `{ items, message }`; app-owned downloads/previews and access checks |
| `message-actions` | `{ message, turn }`; integration approvals, SQL actions or other app behavior |
| `system-message` | `{ message }`; status/repair actions |
| `hints` | `{ adapter }`; app progress/status/errors above the composer |
| `composer` | `{ adapter }`; replace the composer while keeping the shared transcript |
| `input-start`, `composer-tools` | `{ adapter }`; app-owned input adornments and tools |
| `composer-feedback` | `{ adapter }`; action feedback after Send/Stop, wrapping below the controls in a narrow pane |

The element exposes `focus()`, `submit()`, and `stop()`. Focus it only when the
application intentionally opens or activates the conversation, not on each
stream or state update. Closing the element does not cancel work by itself;
the adapter owner must decide whether to cancel, retain, or detach its operation.
For an editor-owned proposal with no cancellation endpoint, omit `canStop`. Keep
`disabled: false` while running and make `canSend` reflect actual availability.
An application may leave `canSend` true for an empty draft when its submit action
needs to show prerequisite guidance beside the button; validation remains owned
by that action. Keep domain validation or proposal controls in the documented
slots, and keep the editor conversation out of unrelated assistant history.
Compact composer density keeps the action targets at least 48px tall even in a
narrow rail on a desktop screen. Give action feedback a wrapping flex basis so
it fits beside the buttons when space permits and below them otherwise.

`AssistantTranscript`, `AssistantPromptInput`, `AssistantComposerActions`, and
`AssistantProgress` are exported separately for compositions with retained
drafts or app-managed uploads. `AssistantPromptInput` accepts `attachmentState`
and an `attachments` slot; it never uploads or deletes files. Its exposed methods
are `focus()`, `preserveHeightForNextModelValue()` and `queueResizeTextarea()`;
`inputElement` exposes the textarea for app-owned editing operations.

## Backend storage contract

```js
import {
  createConversationTranscript, createMemoryConversationStorage
} from "@jskit-ai/assistant-core/server/conversation";

const transcript = createConversationTranscript({ storage: createMemoryConversationStorage() });
await transcript.writeConversationUserMessage(scope, { messageId: requestId, text });
const { conversationLog, pagination } = await transcript.readConversationLogPage(scope, { limit: 20 });
```

The memory adapter is explicitly transient. Applications may supply SQL,
filesystem, document-store, or other storage. JSKIT neither chooses a directory
nor creates database tables. The storage object implements:

```js
{
  read(scope, async transaction => result),
  write(scope, async transaction => result)
}
```

`scope` is opaque to the transcript service. The **server application** derives
it from the authenticated actor, workspace and conversation. Never pass a
client-supplied scope directly into storage. Apply the same authorization to
history, sends, stops, deletion and attachment reads. The memory reference
adapter requires a nonempty string; other adapters may use structured scopes.

Each callback receives these asynchronous operations:

| Transaction operation | Contract |
| --- | --- |
| `listTurnIds()` | Stable IDs in oldest-to-newest order; include all stored turns. |
| `readTurn(id)` | Detached turn snapshot in the client model above, or null if absent. |
| `nextTurnId()` | Allocate an ID after the current tail under the write lock. |
| `hasMessage(messageId)` | Check uniqueness across the whole scoped conversation. |
| `appendMessage(turnId, message)` | Save `{ role, text, messageId, at }`; user messages also carry `attachments` and `turnMetadata`. |
| `replaceAssistant(turnId, message)` | Idempotently replace the final answer for that exact turn, preserving its existing timestamp/identity. |

`write` serializes mutations for the same scope, including duplicate checks and
ID allocation. A successful return means the write is durable for that adapter.
Database adapters should use a transaction; filesystem adapters must publish
the message only after its attachment references and metadata are recoverable.
Errors reject the operation and must remain visible to the caller. Do not
acknowledge a failed save. Reads must not expose mutable backing objects.
Use storage-level locks or transactions when several processes share storage;
an in-process promise queue alone does not provide that guarantee.

The service exposes `readConversationLog`, `readConversationLogPage`,
`conversationMessageIdExists`, `writeConversationUserMessage`,
`writeConversationAssistantMessage`, `writeConversationThinkingMessage`,
`writeConversationCommentaryMessage`, `writeConversationSystemMessage`, and
`upsertConversationAssistantMessage`. Blank messages and duplicate nonempty
message IDs return null. A caller must not interpret a duplicate as permission
to execute a provider turn again. Provider delivery can be uncertain even when
storage succeeded; the app owns its durable admission/reconciliation policy.

User and system messages open turns. Assistant/reasoning/commentary messages
attach to the last unanswered user turn when one exists. Activity can specify
`requireOpenTurn: true`. Final-answer replacement targets an explicit `turnId`.
User metadata and attachment descriptors are supplied to storage unchanged;
their schema, bytes, access controls, retention, cleanup, export and deletion
belong to the app. Never put provider credentials in transcript metadata.

Pagination takes `{ beforeTurnId, limit }`. `limit` is capped at 100; zero means
all turns. An unknown cursor reads the newest page. Results contain oldest-first
`conversationLog` and `pagination`, including `hasMoreBefore`,
`nextBeforeTurnId`, `oldestTurnId`, `newestTurnId`, and `totalTurnCount`.

Run the reusable adapter checks against an isolated fixture:

```js
import { verifyConversationStorageContract } from "@jskit-ai/assistant-core/testing/conversation-storage";
await verifyConversationStorageContract(storage);
```

Those checks cover scoped isolation, concurrent duplicate writes, stable
ordering, pagination, final replacement, attachments and detached reads. An
app must additionally test its authentication, crash/reopen behavior,
multi-process writes, failed commits and attachment cleanup.

## Provider contract

API-model apps can use `createAiClient` and the existing tool-catalog helpers
from `@jskit-ai/assistant-core/server`, or the complete assistant runtime.
Native-agent hosts can import:

- `CodexAppServerJsonRpcClient` from `/server/codex-client`;
- notification classifiers from `/server/codex-events`;
- `createCodexAppServerDetachedTurnWatcher` from `/server/codex-turn`;
- `createOpenCodeServerClient` from `/server/opencode-client`.

These are real execution primitives, also consumed by applications with their
own process and permission owners. They do not spawn an agent, select a user
account, grant filesystem access or install tools.

The Codex client takes `{ endpoint, maxMessageBytes, requestTimeoutMs,
WebSocketImpl }`. It connects to a WebSocket or `unix://` endpoint, then
`initialize({ clientInfo, capabilities })` performs the native handshake.
`request(method, params, { signal })`, `subscribe(callback)`,
`setRequestHandler(callback)` and `close()` expose the connection. The app must
authorize server-initiated tool/approval requests. Missing handlers reject them.
Set transport limits appropriate to the host; the default payload limit is
unbounded. A request abort retires the local request; interrupt a running native
turn with `turn/interrupt` when cancellation must stop provider work.

The detached watcher takes `(provider, threadId, { includeThreadHistory,
onEvent, timeoutMs })`. `provider.subscribe` delivers native notifications;
`provider.readThread` supplies authoritative history when enabled. Call `wait()`
**before** starting the turn, then `setTurnId()` when startup acknowledges it.
This preserves completion/failure notifications that arrive before the start
response. `completeNow`, `failNow`, and `failAfterDetailGrace` handle authoritative
startup statuses. `onEvent` is a synchronous, nonthrowing observer; enqueue
asynchronous persistence in the application. The completion result contains
`{ status, text, threadId, turnId, usage }`. A zero timeout requires provider
`isAvailable()` and `currentConnectionGeneration()` for connection-loss checks.
Always await or handle the wait promise and retire it on startup failure.

The OpenCode client accepts a loopback HTTP `baseUrl`, `directory`, credentials,
and optional `fetchImpl`. It exposes native sessions, prompt, interruption,
messages, status, events, model/agent catalogues and account operations. Response
and event reads are bounded. `allowAttachmentDirectories` defaults to false;
enabling it grants the native conversation access to parent directories of
supplied attachments. Only the host can make that permission decision after
resolving and authorizing each file descriptor.

## Companions and templates

A companion can receive an app-selected layer containing conversation state and
`submitText`, rather than searching the DOM. `createAssistantTextSubmission`
from `/client/conversation-submit` builds that action from
`{ getState, setDraft, submit, afterDraftChange }`. State is
`{ id, active, draft, canSend, turnActive }`. It preserves existing drafts,
supports `{ sendImmediately: false }`, waits briefly for send readiness, and
checks draft/ownership again before using the canonical submit action.
Pass an `AbortSignal` and abort it when selection, visibility or ownership
changes, including switching away and back to the same retained conversation.

The published package contains `examples/conversation`, a standalone Vue app
with a Node backend and no editor dependency. Copy it as an application template
or use the component directly. It runs without credentials using a labelled demo
provider; optional API credentials enable the existing JSKIT model client.
Its backend validates configuration independently of the UI and accepts a
replacement storage module. See its README for commands and scope limits.

## Observation loss and composer responsiveness

`CodexAppServerJsonRpcClient({ endpoint, onDisconnect(error) })` reports an
unexpected close, socket error, or unreadable message once for the current
connection. An explicit `close()` does not call the callback. Obsolete socket
events cannot settle current requests or reach subscribers. The application
owns handling callback failures, verified cancellation, reconnection and any
policy requiring an explicit Resume or Send. A transport disconnect is not
proof that native execution stopped. OpenCode's SSE iterator ending is likewise
not proof that the native session is idle; its consumer owns that decision.

Update `draft` synchronously in `setDraft`. Keep the composer mounted during
external state changes, and change `canSend`, `canStop`, `stopPending` and labels
from authoritative state. Use `disabled` only when typing itself is unavailable.
A stopped session must become sendable without waiting for an unrelated pending
HTTP response. Do not clear the draft on connection recovery or Stop.

The textbox coalesces height measurements once per animation frame, after Vue
applies model changes, and remeasures when its pane width or density changes.
External state changes retain focus and selection. IME composition does not
submit or move focus to Send.
