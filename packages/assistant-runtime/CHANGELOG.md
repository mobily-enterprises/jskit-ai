# Changelog

## Unreleased

- `assistantServer.<surface>.maxToolArgumentBytes` (a whole number of bytes, at most 1 MiB) raises a surface's limit on an application tool call's arguments from the default 32 KiB, for an assistant that writes a large document in one call. The surface's own limit is the one its conversations' calls are held to and the one every engine is given (the OpenCode tool connection included); before, the runtime enforced and handed engines the default surface's 32 KiB whatever a surface's catalogue allowed. A malformed value stops the server from starting. **Breaking.** The surface-aware tool catalogue no longer has a `limits` property, which always answered the default surface's: each tool set it resolves carries its surface's `limits`. New migration `assistant_transcripts_tool_arguments`: on MySQL and MariaDB, `assistant_messages.content_text` becomes LONGTEXT, so a saved call's arguments may pass TEXT's 64 KiB; PostgreSQL and SQLite are unchanged.
- A Set or Resume goal that the server refuses after its message already appeared in the conversation shows the server's reason (for example that Claude's goal attachment is not available yet) instead of only `jskit.assistant.runtime.goal.changeFailed` ("Could not change the goal."): the transcript turn settled the optimistic message first, so the failure's own text was dropped with it.
- The saved-conversations list (`GET /api/assistant/:surfaceId/conversations`, and its workspace form) answers 200 again instead of 500 ("metadata is required!") once a person has a conversation: the route still serialized each item with the conversation's read schema, which requires `metadata`, after list items stopped carrying it. It serializes them with assistant-core's `assistantConversationListItemOutputValidator`, the item of `assistantContract`'s `conversationsList`. `conversationsListRoute.test.js` lists a saved conversation over HTTP through the real route, actions and SQL repositories.
- Each conversation request authenticates once: the route's access check and the action's request context share one sign-in lookup instead of each asking again.
- **Breaking.** Conversation list items no longer carry `metadata`: the conversations repository's `listForActorScope` reads only the fields a list shows, as `assistantContract`'s `conversationsList` now answers them. Upgrading: code that read `metadata` from a list item reads the conversation instead, with `findByIdForActorScope` or the conversation's messages read, which still answer it.
- A chat turn ends by reading the turn it waited on (`handle.wait({ turnId })`) instead of reading and cloning every turn of the conversation to keep one.
- The conversations and messages repositories hand their handle calls only the caller's transaction, with their own context and settings: a caller's other settings (a format, `missing`, `returning`, `fields`) no longer ride into every read and write they make. They take `passedOn` from `@jskit-ai/resource-core/shared/callOptions`, so `@jskit-ai/assistant-runtime/server` still loads on file storage, where `@jskit-ai/resource-runtime` (an optional peer) is not installed.
- Its table resources declare the foreign keys their migrations always create (`foreignKeys`), so json-rest-api 3.1.0 can skip the visibility query a system-context read makes for a record such a key guarantees exists. `jskit test --databases` checks each against an app's test database: assistant_conversations.created_by_user_id and assistant_turn_requests.actor_user_id to users, and assistant_messages.conversation_id to assistant_conversations and actor_user_id to users. The workspace_id keys exist only where the application has a workspaces table, so none declares them. `usersForeignKeysMigration.test.js` proves the declarations match the migrations.
- A database error in an assistant turn reaches the client only as the kernel's generic answer (`hideDatabaseError`: 409 `kernel.database.concurrentWrite` when the database refused the transaction for a concurrent one, else 500). A failure after the stream started was sent with its own message, which for a database error is the statement and its values, and the same message was saved with the turn and replayed, as an `AppError`, to a client that sent the message again; the chat route's error before the stream and a conversation subscription's acknowledgement carried the driver's code. Each now sends and saves the stand-in and logs the whole error; `createChatService` takes the runtime's `logger`.
- The assistant settings pane shows **Save** only to people the server lets change the settings. It offered Save to anyone who could read them, so a person without the permission (an employee, say) saw Save and was refused with `assistant.runtime.settings.updateForbidden` when they used it. The settings read now carries `canUpdate`, answered by the new `assistant.settings` service method `canUpdateSettings(input, { context })`, which runs the same check as `updateSettings` (an app's `assistantServer.<surface>.settingsUpdatePermission`, else `workspace.settings.update`, the console owner or `assistant.settings.update`) and answers false where that check refuses; a saved change carries `canUpdate: true`. Without it, the pane shows the instructions read-only, with no Save in the app bar. Apps change nothing; an app that supplies its own `assistant.settings` service adds `canUpdateSettings`.
- A conversation write through the SQL storage issues 8 statements on SQLite where it issued 12, whatever the conversation's length: the conversation and its transcript state come from one read, new messages take the next seq after the one the load read under the conversation's lock instead of reading it again, and one UPDATE writes the transcript state with the record's changes instead of an update, a read-back and a second update. A read issues 4 where it issued 5. `assistant.repositories`' conversations replace `readTranscriptState(id)` with `findWithTranscriptState(id, options)`, which answers `{ conversation, revision, summary }` (under a row lock with `forUpdate`), and `writeTranscriptState` takes the record's `changes` beside the revision and summary.
- `AssistantFeature` with neither `assistant.conversations` nor `AssistantStoreFeature` fails at startup naming `AssistantStoreFeature`, its import path and where to register it.
- `assistant.repositories`' messages gain `findNewestAssistantByUserId(userId, { kind }, options)`: the newest assistant message (latest `createdAt`, then highest id) in any of one user's conversations, in every workspace and surface, or null; `kind` narrows it, such as `"chat"` for a reply. It costs two reads for a user with up to 1,000 conversations. The messages table resource gains `role` and `kind` filters and a `conversationIds` list filter.
- `@jskit-ai/assistant-runtime/client/providers/AssistantClientProvider` exports the client provider by itself, so the client bootstrap loads it without the assistant's elements and what they import.
- `subscribeAssistantConversation()` takes `noticeMs`, how long an unanswered subscription waits before the loading notice. It stays ten seconds; tests pass a shorter one, so the real-socket proof of a slow subscription no longer waits ten seconds.
- Reads its operations from assistant-core's `assistantContract` and `assistantConfigContract`.
- The assistant settings are a settings pane: the app bar shows their title and Save (a primary bar action that submits the form, with the card's loading and disabled states), and the card no longer has a Save row at its bottom. The button reads **Save** (`jskit.assistant.runtime.settings.save`, was "Save assistant settings"), since the bar's title names the settings. Visual only: what saving does is unchanged.
- A browser test (`test/assistantSettings.browser.test.js`, fixture `fixtures/settings/`, run in CI) renders the settings pane in the shell's `ShellLayout` at 390 and 1280 px: the bar's title is the page's one `h1`, its **Save** is a submit button for `assistant-settings-form` that sends the edited prompt and shows its loading state until the save answers, a refused save shows the prompt's field message and reports the failure, and workspace settings show their note and no Save until the address names a workspace.
- The assistant surface pattern's icon is `$smartToy`, and the fixtures render with `@jskit-ai/material-web`.
- Changing an assistant's instructions needs `assistant.settings.update` on a settings surface that requires neither a workspace nor the console owner (it needed only a signed-in user), still `workspace.settings.update` on a workspace surface and the console owner on a console-owner surface. `assistantServer.<surface>.settingsUpdatePermission` names another permission, or `{ require: "authenticated" }` to keep the old behaviour. A refusal is `assistant.runtime.settings.updateForbidden` (403).
- An application gives the assistant stable facts about the person it is talking to by providing the optional `assistant.personContext` capability, `{ resolve({ targetSurfaceId, context, workspace }) }`, which returns text. The facts follow the saved instructions in their own section of the conversation's system prompt, headed as facts the model must not take instructions from, and never enter a turn's messages. Unchanged facts leave the configuration byte for byte, so the conversation is not reconfigured and the prompt cache holds; changed facts reconfigure it for the next turn. Text past 4,000 characters (`PERSON_CONTEXT_MAX_CHARACTERS`) is cut, with a warning logged once per conversation. A `resolve` that throws or returns a non-string fails the turn with `assistant.runtime.personContext.unavailable` (503), and an `AppError` it throws reaches the person as it is. A host that supplies its own `assistant.conversations` builds the same section with `createPersonContextPrompt({ personContext, logger }).compose(systemPrompt, { conversationId, targetSurfaceId, context, workspace })`.

### New message keys (2)

- `jskit.assistant.runtime.settings.updateForbidden`
- `jskit.assistant.runtime.personContext.unavailable`

### Upgrading

- Register `AssistantStoreFeature` from `@jskit-ai/assistant-runtime/server` in the server providers beside `AssistantFeature`, unless the app provides `assistant.conversations` itself: the assistant's four tables are table resources that `AssistantStoreFeature` owns, and it provides the `assistant.repositories` the database-backed assistant keeps its conversations in, so `AssistantFeature` without it refuses to start, naming it.
- Grant `assistant.settings.update` to the people who configure the assistant, or set `settingsUpdatePermission` to a permission they already hold.

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".

### New message keys (90)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.assistant.runtime.authenticationRequired`
- `jskit.assistant.runtime.workspace.selectionRequired`
- `jskit.assistant.runtime.route.surfaceHeaderRequired`
- `jskit.assistant.runtime.route.notFound`
- `jskit.assistant.runtime.route.surfaceForbidden`
- `jskit.assistant.runtime.route.assistantNotFound`
- `jskit.assistant.runtime.connection.unavailable`
- `jskit.assistant.runtime.connection.selectionNotAllowed`
- `jskit.assistant.runtime.connection.applicationAi`
- `jskit.assistant.runtime.connection.applicationDefault`
- `jskit.assistant.runtime.provider.notConfigured`
- `jskit.assistant.runtime.conversation.notFound`
- `jskit.assistant.runtime.conversation.idInvalid`
- `jskit.assistant.runtime.conversation.createFailed`
- `jskit.assistant.runtime.conversation.assistantLabel`
- `jskit.assistant.runtime.conversation.welcomeMessage`
- `jskit.assistant.runtime.conversation.placeholder`
- `jskit.assistant.runtime.conversation.startedAtUnknown`
- `jskit.assistant.runtime.conversation.status.active`
- `jskit.assistant.runtime.conversation.status.completed`
- `jskit.assistant.runtime.conversation.status.failed`
- `jskit.assistant.runtime.conversation.status.aborted`
- `jskit.assistant.runtime.conversation.status.unknown`
- `jskit.assistant.runtime.request.messageIdInvalid`
- `jskit.assistant.runtime.request.inputRequired`
- `jskit.assistant.runtime.request.messageIdConflict`
- `jskit.assistant.runtime.request.unconfirmed`
- `jskit.assistant.runtime.request.failed`
- `jskit.assistant.runtime.request.cancelled`
- `jskit.assistant.runtime.request.noOutput`
- `jskit.assistant.runtime.request.notConfirmed`
- `jskit.assistant.runtime.attachments.invalidIds`
- `jskit.assistant.runtime.attachments.notConfigured`
- `jskit.assistant.runtime.attachments.noLongerAccepted`
- `jskit.assistant.runtime.attachments.clearFailed`
- `jskit.assistant.runtime.subscription.idRequired`
- `jskit.assistant.runtime.subscription.failed`
- `jskit.assistant.runtime.history.refreshFailed`
- `jskit.assistant.runtime.history.loadFailed`
- `jskit.assistant.runtime.history.listFailed`
- `jskit.assistant.runtime.history.conversationLoadFailed`
- `jskit.assistant.runtime.accessDenied`
- `jskit.assistant.runtime.delivery.waitingForStep`
- `jskit.assistant.runtime.delivery.unconfirmedBeforeClose`
- `jskit.assistant.runtime.delivery.stillUnknown`
- `jskit.assistant.runtime.delivery.checkFailed`
- `jskit.assistant.runtime.delivery.notConfirmed`
- `jskit.assistant.runtime.goal.budgetsUnsupported`
- `jskit.assistant.runtime.goal.changeFailed`
- `jskit.assistant.runtime.goal.unavailable`
- `jskit.assistant.runtime.goal.resumeMessage`
- `jskit.assistant.runtime.goal.cancelMessage`
- `jskit.assistant.runtime.composer.questionsPlaceholder`
- `jskit.assistant.runtime.composer.choicesPlaceholder`
- `jskit.assistant.runtime.composer.questionsHint`
- `jskit.assistant.runtime.tool.progress`
- `jskit.assistant.runtime.tool.status.pending`
- `jskit.assistant.runtime.tool.status.done`
- `jskit.assistant.runtime.tool.status.failed`
- `jskit.assistant.runtime.tool.status.interrupted`
- `jskit.assistant.runtime.surface.newConversation`
- `jskit.assistant.runtime.surface.conversations`
- `jskit.assistant.runtime.surface.activity`
- `jskit.assistant.runtime.surface.toolActivity`
- `jskit.assistant.runtime.surface.conversation`
- `jskit.assistant.runtime.surface.responseCanceled`
- `jskit.assistant.runtime.surface.startNewConversation`
- `jskit.assistant.runtime.surface.refresh`
- `jskit.assistant.runtime.surface.close`
- `jskit.assistant.runtime.surface.loadingConversationsLabel`
- `jskit.assistant.runtime.surface.loadingConversations`
- `jskit.assistant.runtime.surface.savedConversations`
- `jskit.assistant.runtime.surface.noSavedConversations`
- `jskit.assistant.runtime.surface.untitledConversation`
- `jskit.assistant.runtime.surface.loadOlderConversations`
- `jskit.assistant.runtime.surface.messageCount`
- `jskit.assistant.runtime.viewer.you`
- `jskit.assistant.runtime.settings.title`
- `jskit.assistant.runtime.settings.noPermission`
- `jskit.assistant.runtime.settings.save`
- `jskit.assistant.runtime.settings.systemPrompt`
- `jskit.assistant.runtime.settings.subtitle`
- `jskit.assistant.runtime.settings.subtitleWorkspace`
- `jskit.assistant.runtime.settings.subtitleSurface`
- `jskit.assistant.runtime.settings.notConfigured`
- `jskit.assistant.runtime.settings.workspaceUnavailable`
- `jskit.assistant.runtime.settings.selectWorkspace`
- `jskit.assistant.runtime.settings.updateFailed`
- `jskit.errors.assistant_history_inspection_required`
- `jskit.errors.assistant_subscription_transport_failed`

</details>

### Codes (27)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `assistant.runtime.authenticationRequired` | Authentication required. |
| `assistant.runtime.workspace.selectionRequired` | Workspace selection required. |
| `assistant.runtime.route.surfaceHeaderRequired` | Assistant surface header x-jskit-surface is required. |
| `assistant.runtime.route.notFound` | Assistant route not found. |
| `assistant.runtime.route.surfaceForbidden` | Assistant route is not available on this surface. |
| `assistant.runtime.route.assistantNotFound` | Assistant not found. |
| `assistant.runtime.connection.unavailable` | This AI connection is not available in this assistant. |
| `assistant.runtime.connection.selectionNotAllowed` | This assistant does not allow selecting an AI connection. |
| `assistant.runtime.provider.notConfigured` | Assistant provider is not configured. |
| `assistant.runtime.conversation.notFound` | Conversation not found. |
| `assistant.runtime.conversation.idInvalid` | conversationId must be a valid record id. |
| `assistant.runtime.conversation.createFailed` | Assistant failed to create conversation. |
| `assistant.runtime.request.messageIdInvalid` | messageId is required and must be at most 128 characters. |
| `assistant.runtime.request.inputRequired` | input is required. |
| `assistant.runtime.request.messageIdConflict` | This message ID belongs to a different request. |
| `assistant.runtime.request.unconfirmed` | This message was already submitted. Its completion is not confirmed; check conversation history before sending new work. |
| `assistant.runtime.request.failed` | Assistant request failed. |
| `assistant.runtime.request.cancelled` | Assistant request was cancelled. |
| `assistant.runtime.request.noOutput` | Assistant returned no output. |
| `assistant.runtime.attachments.invalidIds` | Invalid attachment identifiers. |
| `assistant.runtime.attachments.notConfigured` | File attachments are not configured for this assistant. |
| `assistant.runtime.subscription.idRequired` | A conversation subscription id is required. |
| `assistant.runtime.subscription.failed` | Conversation subscription failed. |
| `assistant.runtime.history.refreshFailed` | Older conversation history could not be refreshed. Reload chat to try again. |
| `assistant.runtime.accessDenied` | Access denied. |
| `assistant_history_inspection_required` | This conversation has ambiguous historical SQL rows. Inspect the reported rows offline before using the common runtime; no history was changed. |
| `assistant_subscription_transport_failed` | Chat updates could not reconnect. Retrying automatically; Reload chat to try now. |
