# Changelog

## Unreleased

- The assistant settings are a settings pane: the app bar shows their title and Save (a primary bar action that submits the form, with the card's loading and disabled states), and the card no longer has a Save row at its bottom. The button reads **Save** (`jskit.assistant.runtime.settings.save`, was "Save assistant settings"), since the bar's title names the settings. Visual only: what saving does is unchanged.
- A browser test (`test/assistantSettings.browser.test.js`, fixture `fixtures/settings/`, run in CI) renders the settings pane in the shell's `ShellLayout` at 390 and 1280 px: the bar's title is the page's one `h1`, its **Save** is a submit button for `assistant-settings-form` that sends the edited prompt and shows its loading state until the save answers, a refused save shows the prompt's field message and reports the failure, and workspace settings show their note and no Save until the address names a workspace.
- The assistant surface pattern's icon is `$smartToy`, and the fixtures render with `@jskit-ai/material-web`.
- Changing an assistant's instructions needs `assistant.settings.update` on a settings surface that requires neither a workspace nor the console owner (it needed only a signed-in user), still `workspace.settings.update` on a workspace surface and the console owner on a console-owner surface. `assistantServer.<surface>.settingsUpdatePermission` names another permission, or `{ require: "authenticated" }` to keep the old behaviour. A refusal is `assistant.runtime.settings.updateForbidden` (403).
- An application gives the assistant stable facts about the person it is talking to by providing the optional `assistant.personContext` capability, `{ resolve({ targetSurfaceId, context, workspace }) }`, which returns text. The facts follow the saved instructions in their own section of the conversation's system prompt, headed as facts the model must not take instructions from, and never enter a turn's messages. Unchanged facts leave the configuration byte for byte, so the conversation is not reconfigured and the prompt cache holds; changed facts reconfigure it for the next turn. Text past 4,000 characters (`PERSON_CONTEXT_MAX_CHARACTERS`) is cut, with a warning logged once per conversation. A `resolve` that throws or returns a non-string fails the turn with `assistant.runtime.personContext.unavailable` (503), and an `AppError` it throws reaches the person as it is. A host that supplies its own `assistant.conversations` builds the same section with `createPersonContextPrompt({ personContext, logger }).compose(systemPrompt, { conversationId, targetSurfaceId, context, workspace })`.

### New message keys (2)

- `jskit.assistant.runtime.settings.updateForbidden`
- `jskit.assistant.runtime.personContext.unavailable`

### Upgrading

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
