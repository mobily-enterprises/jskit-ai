# Changelog

## Unreleased

- Test fixture only: the responsive assistant fixture's avatar is drawn in the theme's `primary` and `on-primary` roles instead of a raw `#6750a4` and `white`, so it follows the dark scheme like the rest of the conversation. A package test runs `jskit check m3`'s raw-colour rule over the fixture, which the check itself skips with every `fixtures/` folder.
- The assistant settings resource (`assistantConfigResource`) has a required boolean `canUpdate` attribute: whether the signed-in person may change the settings, as the server decides (`@jskit-ai/assistant-runtime`'s settings pane shows Save only when it is true).
- **Breaking (data-access redesign).** The assistant operations are API contracts: `assistantContract` and `assistantConfigContract` (view and patch, the two its routes serve).
- The OpenAI SDK loads with an OpenAI-compatible client's first completion instead of with the server, so a boot of an app with the assistant loads 154 fewer modules (0.13 s on their own).
- A subscriber hears a streamed delta (an in-progress message) on an authorization under a second old instead of authorizing again for each one: every delta used to wait for one `authorize` call per subscriber before the stream continued (one SELECT each in `@jskit-ai/assistant-runtime`), so a 200-delta reply to one open page cost about 200 reads and now costs as many as a 10-delta one. Every other event (admission, phase, saved message, settlement) still authorizes again, and a revoked subscriber stops hearing the turn within a second.
- The conversation's remaining boxes are Material 3 tonal containers instead of outlines, visual only: queued and sent attachments and the questions are `surface-container-high`, code blocks and inline code `surface-container-highest`, tables and details `surface-container-low` (a table keeps `outline-variant` row dividers), question numbers `secondary-container` badges, and the model menu a `surface-container` surface at elevation level 2 with `outline-variant` dividers. The composer stays Material 3's outlined text field, the only outline left.
- `AssistantSettingsFormCard` takes a `formId`: its form gets that id and the card draws no Save button of its own, so the page's app bar can carry Save as a submit button for the form (`type="submit" form="<formId>"`), as a Material 3 settings pane does. Without one, the card keeps its Save; a person who may not save still sees the read-only note.
- Material 3 containers in the conversation, visual only: the transcript area is no longer outlined (its bubbles are the only containers, and the welcome bubble is a tonal fill without an outline), the composer is Material 3's outlined text field (4dp corners, the `outline` role, a 2dp primary outline on focus, 16dp side padding) with Send and the other actions 12dp from it (8dp when compact), and `AssistantSettingsFormCard` adds no heading or divider inside the settings pane that titles it: its subtitle is the card's first line and its title names the section for assistive technology.
- The avatar's Show and Minimise buttons set no fixed size: they are 40dp icon buttons with material-web's 48dp touch target, so `jskit check m3` passes on `AssistantConversationElement`. The collapsed Show button is 40dp wide like Minimise, no longer 44dp.
- The goal menu closes when Cancel succeeds, as it does after Start; Pause and Resume keep it open.
- `AssistantConversationElement` has an `avatar-thumbnail` slot, with the `{ size, height }` scope of the other avatar slots: while the avatar is hidden, the **Show avatar** button draws its content instead of the anonymous account icon, such as a still miniature of the avatar, clipped to the button's round 32-pixel disc. The button keeps its label, title and 44-pixel target, and shows the icon as before without the slot.
- A delivered Codex turn is held as not yet started only until Codex reports it: a `turn/started` that arrives before the `turn/start` answer counts, and a thread read listing exactly that turn as completed or failed settles a turn whose notifications were missed, so its answer is no longer kept waiting for a notification that never comes.
- The API driver's state note, which carries the current time, follows the conversation as its last message instead of ending the system prompt, so the provider's prompt cache keeps the whole history from one turn to the next instead of charging it uncached on each turn's first model call (`@jskit-ai/agent` `runLoop`).
- The assistant settings card is an elevated Material 3 card without a border, and the long-text preview's table alignment no longer needs `!important`.
- Icons are Material Symbols `$aliases` (from `@jskit-ai/material-web`) instead of `@mdi/js` paths, and text uses Vuetify 4's Material 3 type classes (`text-body-large`, `text-title-medium`, ...) instead of Material 2 ones, which Vuetify 4 no longer styles. Upgrading: see the guide's [Move an app to the Material 3 defaults](https://mobily-enterprises.github.io/jskit-ai/guide/app-setup/material-3-migration).
- Assistant failures that reach a person translate: 63 more undotted codes render from `jskit.errors.<code>`, and 98 sentences that share a code with others, or are sent without one, carry a `messageCode` (`assistant.claude.*`, `assistant.codex.*`, `assistant.opencode.*`, `assistant.conversation.*`, `assistant.turn.*`). The English messages are unchanged.
- The OpenCode version mismatch, Claude control-request timeout and unreadable saved Claude conversation errors carry `params` for their catalog English.
- The assistant settings resource sends its system prompt field messages in the coded `{ code, message, params }` form.

- Custom model endpoints: `customAiProvider({ engineId, baseUrl, model, contextWindow })` (with `CUSTOM_AI_PROVIDER_ID`, `CUSTOM_AI_MINIMUM_CONTEXT`, `CUSTOM_AI_PLACEHOLDER_TOKEN` and `connectionAiProvider`) in `shared/native-providers` describes a model server the host's user runs, such as Ollama, LM Studio, `llama-server` or vLLM, in the native provider shape, so Codex, Claude Code and the Colleague drivers connect to it. Codex gets no bearer token without a key, no freeform `apply_patch` and no parallel tool calls; Claude Code always gets a token (the key, or `local`) so a saved claude.ai login never reaches the endpoint, its model in every slot and an output limit of a quarter of the context. The Codex history adapter routes `custom~<base64url(baseUrl)>` to plain `http(s)` upstreams only and ends a turn whose server is down with `assistant_custom_endpoint_unreachable`. `readCodexCustomModels(codexHome)` reads a custom Codex home's catalogue.
- `server/custom-endpoint` adds `checkCustomEndpoint` (one bounded request on the engine's own API, up to 2 minutes, then Ollama's loaded context from `/api/ps`, refusing one smaller than entered), `verifyCustomEndpoint`, `readOllamaLoadedContext` and `probeCustomEndpoint` (one model-list read for health). Errors carry `custom_endpoint_*` codes and say what to fix.

### New message keys (164)

<details><summary>Key list</summary>

- `jskit.assistant.settings.systemPromptTooLong`
- `jskit.assistant.settings.systemPromptInvalid`
- `jskit.assistant.turn.invalidResponse`
- `jskit.assistant.turn.requestIncomplete`
- `jskit.assistant.conversation.contextChangedInstallingPrompt`
- `jskit.assistant.conversation.contextChangedReadingInstructions`
- `jskit.assistant.conversation.messageNotAcknowledged`
- `jskit.assistant.conversation.stopTemporaryBeforeChange`
- `jskit.assistant.conversation.toolArgumentsTooLarge`
- `jskit.assistant.conversation.toolCallLimit`
- `jskit.assistant.claude.accountChangedRefreshModels`
- `jskit.assistant.claude.accountQueryCancelled`
- `jskit.assistant.claude.accountQueryCleanupUnconfirmed`
- `jskit.assistant.claude.answerInterrupted`
- `jskit.assistant.claude.chooseConnectedModel`
- `jskit.assistant.claude.closedOrWorking`
- `jskit.assistant.claude.connectionClosed`
- `jskit.assistant.claude.connectionWasClosed`
- `jskit.assistant.claude.controlNeedsTerminal`
- `jskit.assistant.claude.eventConnectionEnded`
- `jskit.assistant.claude.exitedUnexpectedly`
- `jskit.assistant.claude.modelUnsupported`
- `jskit.assistant.claude.noTurnToSteer`
- `jskit.assistant.claude.otherHostConfiguration`
- `jskit.assistant.claude.reasoningEffortUnsupported`
- `jskit.assistant.claude.reconnecting`
- `jskit.assistant.claude.sendNowUnsupported`
- `jskit.assistant.claude.signInRequired`
- `jskit.assistant.claude.stopBeforeReset`
- `jskit.assistant.claude.toolCallLimit`
- `jskit.assistant.claude.turnStillWorking`
- `jskit.assistant.claude.workEnded`
- `jskit.assistant.claude.outputTooLarge`
- `jskit.assistant.codex.accountChangedSendAgain`
- `jskit.assistant.codex.accountUnavailable`
- `jskit.assistant.codex.assistantChangedRefresh`
- `jskit.assistant.codex.authChangedReopen`
- `jskit.assistant.codex.authModeUnsupported`
- `jskit.assistant.codex.authRecordInvalid`
- `jskit.assistant.codex.authRecordTooLarge`
- `jskit.assistant.codex.authRecordUnreadable`
- `jskit.assistant.codex.authorizedSettingsRequired`
- `jskit.assistant.codex.connectionClosedBeforeSettings`
- `jskit.assistant.codex.connectionUnverified`
- `jskit.assistant.codex.credentialsUnreadable`
- `jskit.assistant.codex.ephemeralInstructionsFixed`
- `jskit.assistant.codex.goalPauseUnconfirmed`
- `jskit.assistant.codex.goalsAreControls`
- `jskit.assistant.codex.helperAccessTokenStale`
- `jskit.assistant.codex.helperAccountActivationFailed`
- `jskit.assistant.codex.helperAccountChanged`
- `jskit.assistant.codex.helperAccountChangedBeforeRun`
- `jskit.assistant.codex.helperAccountChangedStarting`
- `jskit.assistant.codex.helperAccountIdentityInvalid`
- `jskit.assistant.codex.helperAuthRefreshRejected`
- `jskit.assistant.codex.helperAuthUnavailable`
- `jskit.assistant.codex.helperExecutionFailed`
- `jskit.assistant.codex.helperThreadReconnectAccount`
- `jskit.assistant.codex.historyFormatStartFresh`
- `jskit.assistant.codex.historyFormatUnsupported`
- `jskit.assistant.codex.loadedThreadsInvalid`
- `jskit.assistant.codex.modelDiscoveryUnavailable`
- `jskit.assistant.codex.modelUnsupported`
- `jskit.assistant.codex.nativeGoalChanged`
- `jskit.assistant.codex.observationLostStopUnverified`
- `jskit.assistant.codex.oldThreadUnreadable`
- `jskit.assistant.codex.otherAccount`
- `jskit.assistant.codex.otherHostConfiguration`
- `jskit.assistant.codex.otherProviderAccount`
- `jskit.assistant.codex.outputTooLarge`
- `jskit.assistant.codex.paginatedConversationHistoryMissing`
- `jskit.assistant.codex.paginatedHistoryMissing`
- `jskit.assistant.codex.reasoningEffortUnsupported`
- `jskit.assistant.codex.reconnectOpenAi`
- `jskit.assistant.codex.responseTimeout`
- `jskit.assistant.codex.signInRequired`
- `jskit.assistant.codex.stillReconnecting`
- `jskit.assistant.codex.stoppedUseResume`
- `jskit.assistant.codex.temporaryConnectionLost`
- `jskit.assistant.codex.temporaryConversationClosed`
- `jskit.assistant.codex.temporaryTurnStopped`
- `jskit.assistant.codex.threadInventoryUntrusted`
- `jskit.assistant.codex.toolEntryPointsChanged`
- `jskit.assistant.codex.turnStopUnconfirmed`
- `jskit.assistant.opencode.cleanupUnconfirmed`
- `jskit.assistant.opencode.closedOrWorking`
- `jskit.assistant.opencode.messageNotAcknowledged`
- `jskit.assistant.opencode.modelDefinitionUnavailable`
- `jskit.assistant.opencode.nativeStillWorking`
- `jskit.assistant.opencode.noTurnToSteer`
- `jskit.assistant.opencode.otherAccount`
- `jskit.assistant.opencode.otherHistoryStore`
- `jskit.assistant.opencode.otherHistoryStoreOrRuntime`
- `jskit.assistant.opencode.otherWorkingDirectory`
- `jskit.assistant.opencode.reasoningEffortUnsupported`
- `jskit.assistant.opencode.reopenTerminalToAttach`
- `jskit.assistant.opencode.savedConversationUnavailable`
- `jskit.assistant.opencode.turnFailed`
- `jskit.assistant.opencode.turnUnreadable`
- `jskit.assistant.opencode.turnNotFinished`
- `jskit.errors.conversation_claude_turn_timeout`
- `jskit.errors.conversation_claude_renewal_history_mismatch`
- `jskit.errors.conversation_claude_renewal_unrelated_history`
- `jskit.errors.conversation_claude_renewal_turn_active`
- `jskit.errors.conversation_claude_unavailable`
- `jskit.errors.conversation_claude_retained_goal_invalid`
- `jskit.errors.conversation_claude_retained_goal_conflict`
- `jskit.errors.conversation_claude_session_closing`
- `jskit.errors.conversation_claude_preparation_stopped`
- `jskit.errors.conversation_claude_terminal_turn_active`
- `jskit.errors.conversation_claude_still_working`
- `jskit.errors.conversation_claude_history_retire_busy`
- `jskit.errors.conversation_claude_message_required`
- `jskit.errors.conversation_claude_command_stopped`
- `jskit.errors.conversation_claude_context_usage_unavailable`
- `jskit.errors.conversation_claude_goal_clear_unconfirmed`
- `jskit.errors.conversation_claude_saved_state_unreadable`
- `jskit.errors.conversation_tool_not_executed`
- `jskit.errors.conversation_tool_outcome_unknown`
- `jskit.errors.conversation_unsupported`
- `jskit.errors.assistant_claude_goal_attachment_pending`
- `jskit.errors.assistant_claude_admission_unknown`
- `jskit.errors.assistant_claude_startup_exited`
- `jskit.errors.claude_stop_unconfirmed`
- `jskit.errors.claude_account_changed`
- `jskit.errors.assistant_opencode_recovery_order_unconfirmed`
- `jskit.errors.assistant_opencode_interrupt_unconfirmed`
- `jskit.errors.assistant_opencode_interrupt_timeout`
- `jskit.errors.assistant_opencode_key_verification_unavailable`
- `jskit.errors.assistant_opencode_stop_unverified`
- `jskit.errors.assistant_opencode_connection_reload_failed`
- `jskit.errors.assistant_opencode_response_too_large`
- `jskit.errors.assistant_opencode_event_too_large`
- `jskit.errors.assistant_opencode_directory_unavailable`
- `jskit.errors.assistant_opencode_catalog_invalid`
- `jskit.errors.assistant_opencode_catalog_stop_failed`
- `jskit.errors.assistant_opencode_events_timeout`
- `jskit.errors.assistant_opencode_observation_lost`
- `jskit.errors.assistant_opencode_parent_unverified`
- `jskit.errors.assistant_opencode_start_timeout`
- `jskit.errors.assistant_opencode_version_mismatch`
- `jskit.errors.assistant_opencode_zen_catalog_unavailable`
- `jskit.errors.assistant_agent_control_binding_retained`
- `jskit.errors.assistant_codex_provider_binding_retained`
- `jskit.errors.assistant_codex_provider_switch_busy`
- `jskit.errors.assistant_codex_history_request_too_large`
- `jskit.errors.assistant_codex_history_request_unreadable`
- `jskit.errors.assistant_codex_app_server_message_too_large`
- `jskit.errors.codex_reconnect_required`
- `jskit.errors.codex_provider_connection_changed`
- `jskit.errors.codex_runtime_invalidated`
- `jskit.errors.assistant_provider_fetch_missing`
- `jskit.errors.assistant_tool_arguments_invalid`
- `jskit.errors.assistant_tool_result_unserializable`
- `jskit.errors.assistant_tool_result_too_large`
- `jskit.errors.assistant_tool_contract_too_large`
- `jskit.errors.assistant_tool_arguments_too_large`
- `jskit.errors.assistant_action_cursor_invalid`
- `jskit.errors.assistant_action_unknown`
- `jskit.errors.assistant_action_contract_required`
- `jskit.errors.assistant_tool_output_invalid`
- `jskit.errors.assistant_tool_unknown`
- `jskit.errors.assistant_claude_control_timeout`
- `jskit.errors.assistant_custom_endpoint_unreachable`

</details>

### Codes (164)

Error, field-error and message codes this package now sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `assistant.settings.systemPromptTooLong` | Assistant system prompt must be at most {max} characters. |
| `assistant.settings.systemPromptInvalid` | Assistant system prompt must be valid text. |
| `assistant.turn.invalidResponse` | The assistant returned an invalid response. |
| `assistant.turn.requestIncomplete` | The assistant could not complete this request. |
| `assistant.conversation.contextChangedInstallingPrompt` | Conversation context changed while installing its system prompt. Retry before sending. |
| `assistant.conversation.contextChangedReadingInstructions` | Conversation context changed while reading instructions. Retry before sending. |
| `assistant.conversation.messageNotAcknowledged` | The engine did not acknowledge the message. |
| `assistant.conversation.stopTemporaryBeforeChange` | Stop this temporary conversation before changing its AI. |
| `assistant.conversation.toolArgumentsTooLarge` | The application tool arguments exceed their size limit. |
| `assistant.conversation.toolCallLimit` | The assistant reached the application tool-call limit for this turn. |
| `assistant.claude.accountChangedRefreshModels` | The signed-in Claude account changed. Refresh the model list. |
| `assistant.claude.accountQueryCancelled` | Claude account query was cancelled for reconnection. |
| `assistant.claude.accountQueryCleanupUnconfirmed` | Claude account query process cleanup could not be confirmed. |
| `assistant.claude.answerInterrupted` | Claude interrupted this answer. |
| `assistant.claude.chooseConnectedModel` | Choose a connected Claude Code model. |
| `assistant.claude.closedOrWorking` | This Claude conversation is closed or already working. |
| `assistant.claude.connectionClosed` | Claude connection is closed. |
| `assistant.claude.connectionWasClosed` | Claude connection was closed. |
| `assistant.claude.controlNeedsTerminal` | This control request requires the native Claude Code terminal. |
| `assistant.claude.eventConnectionEnded` | Claude event connection ended unexpectedly. |
| `assistant.claude.exitedUnexpectedly` | Claude exited unexpectedly. |
| `assistant.claude.modelUnsupported` | This exact provider/model is not supported by the Claude integration. Choose a supported model without renaming it. |
| `assistant.claude.noTurnToSteer` | Claude has no active turn to steer. |
| `assistant.claude.otherHostConfiguration` | This Claude conversation belongs to another working directory or credential home. Restore its original host configuration. |
| `assistant.claude.reasoningEffortUnsupported` | The selected Claude model does not support this reasoning effort. |
| `assistant.claude.reconnecting` | Claude is reconnecting. |
| `assistant.claude.sendNowUnsupported` | This Claude version does not support targeted Send now. |
| `assistant.claude.signInRequired` | Sign in with claude auth login before using this conversation. |
| `assistant.claude.stopBeforeReset` | Stop Claude before resetting its turn view. |
| `assistant.claude.toolCallLimit` | Claude exceeded the application tool-call limit. |
| `assistant.claude.turnStillWorking` | This Claude turn is still working. |
| `assistant.claude.workEnded` | Claude work ended. |
| `assistant.claude.outputTooLarge` | Claude output exceeded its size limit. |
| `assistant.codex.accountChangedSendAgain` | Codex (OpenAI) changed account. Send your message again. |
| `assistant.codex.accountUnavailable` | The selected Codex account is unavailable. Reconnect Codex and retry. |
| `assistant.codex.assistantChangedRefresh` | The assistant changed. Refresh before resuming. |
| `assistant.codex.authChangedReopen` | Codex authentication changed. Reopen the conversation with its original account. |
| `assistant.codex.authModeUnsupported` | The selected Codex authentication mode is unsupported. Reconnect Codex and retry. |
| `assistant.codex.authRecordInvalid` | The selected Codex authentication record is invalid. Reconnect Codex and retry. |
| `assistant.codex.authRecordTooLarge` | The selected Codex authentication record is too large. Reconnect Codex and retry. |
| `assistant.codex.authRecordUnreadable` | The selected Codex authentication record could not be read. Reconnect Codex and retry. |
| `assistant.codex.authorizedSettingsRequired` | Codex requires current authorized settings before resuming this conversation. |
| `assistant.codex.connectionClosedBeforeSettings` | The assistant connection closed before confirming its settings. |
| `assistant.codex.connectionUnverified` | The assistant connection could not be verified. Your conversation and files are preserved. Retry the connection, or renew the session to continue in a fresh conversation. |
| `assistant.codex.credentialsUnreadable` | Codex credential data could not be read. Restore its account configuration. |
| `assistant.codex.ephemeralInstructionsFixed` | Start a new ephemeral conversation to change its instructions. |
| `assistant.codex.goalPauseUnconfirmed` | Codex did not confirm that the same goal was paused. |
| `assistant.codex.goalsAreControls` | Codex goals are controls. Inspect any unresolved goal-message record before continuing. |
| `assistant.codex.helperAccessTokenStale` | The selected Codex account has not produced a newer access token yet. Reconnect Codex and retry. |
| `assistant.codex.helperAccountActivationFailed` | Codex could not activate the selected account for isolated helper work. Reconnect Codex and retry. |
| `assistant.codex.helperAccountChanged` | The selected Codex account changed during helper work. Retry the task with the current account. |
| `assistant.codex.helperAccountChangedBeforeRun` | The selected Codex account changed before low-cost assistant work could run. Retry the task with the current account. |
| `assistant.codex.helperAccountChangedStarting` | The selected Codex account changed while helper execution was starting. Retry the task. |
| `assistant.codex.helperAccountIdentityInvalid` | The requested low-cost assistant account identity is invalid. Refresh the task and retry. |
| `assistant.codex.helperAuthRefreshRejected` | Codex helper authentication refresh was rejected. Reconnect Codex and retry. |
| `assistant.codex.helperAuthUnavailable` | Codex helper authentication is unavailable. Reconnect Codex and retry. |
| `assistant.codex.helperExecutionFailed` | Codex isolated helper execution failed. Retry the task. |
| `assistant.codex.helperThreadReconnectAccount` | Reconnect the original Codex account to resume or delete this helper thread. |
| `assistant.codex.historyFormatStartFresh` | This conversation uses an unsupported Codex history format. Start a fresh conversation. |
| `assistant.codex.historyFormatUnsupported` | This conversation uses an unsupported Codex history format. Renew the session to keep your files and saved chat and start a fresh conversation. You can write the handover yourself. |
| `assistant.codex.loadedThreadsInvalid` | Codex returned an invalid loaded-thread inventory. Restore its connection before retrying. |
| `assistant.codex.modelDiscoveryUnavailable` | Codex live model discovery is unavailable. |
| `assistant.codex.modelUnsupported` | This exact provider/model is not supported by the Codex integration. Choose a supported model without renaming it. |
| `assistant.codex.nativeGoalChanged` | The native goal changed. Read it again before changing it. |
| `assistant.codex.observationLostStopUnverified` | Codex observation was lost and a stop is not yet verified. Retry after the service has stopped. |
| `assistant.codex.oldThreadUnreadable` | The old assistant thread cannot be read. Write or edit the handover manually instead. |
| `assistant.codex.otherAccount` | This conversation belongs to another Codex account. Restore that account or start a new conversation. |
| `assistant.codex.otherHostConfiguration` | This Codex conversation belongs to another working directory or credential home. Restore its original host configuration. |
| `assistant.codex.otherProviderAccount` | This conversation belongs to another Codex provider account. Restore that connection or start a new conversation. |
| `assistant.codex.outputTooLarge` | Codex output exceeded the configured limit. |
| `assistant.codex.paginatedConversationHistoryMissing` | Codex did not create the required paginated conversation history. Update Codex before starting a conversation. |
| `assistant.codex.paginatedHistoryMissing` | Codex did not create the required paginated history. Update Codex before starting this conversation. |
| `assistant.codex.reasoningEffortUnsupported` | The selected Codex model does not support this reasoning effort. |
| `assistant.codex.reconnectOpenAi` | Reconnect the OpenAI account before using this model. |
| `assistant.codex.responseTimeout` | Timed out waiting for Codex app-server response. |
| `assistant.codex.signInRequired` | Sign in with codex login before using this conversation. |
| `assistant.codex.stillReconnecting` | Codex is still reconnecting: its shared runtime is busy starting or stopping. Please try again shortly. |
| `assistant.codex.stoppedUseResume` | Codex is stopped. Use Resume or Send to continue. |
| `assistant.codex.temporaryConnectionLost` | Connection to Codex was lost while the temporary AI was working. |
| `assistant.codex.temporaryConversationClosed` | Temporary AI conversation was closed. |
| `assistant.codex.temporaryTurnStopped` | Temporary AI turn was stopped. |
| `assistant.codex.threadInventoryUntrusted` | Codex returned an untrustworthy thread/provider inventory. Restore its connection before changing credentials. |
| `assistant.codex.toolEntryPointsChanged` | This Codex conversation was created with different application tool entry points. Start a new conversation to enable or remove application tools. |
| `assistant.codex.turnStopUnconfirmed` | Codex did not confirm that its turn stopped. |
| `assistant.opencode.cleanupUnconfirmed` | OpenCode process cleanup could not be confirmed. Restore its execution host before continuing. |
| `assistant.opencode.closedOrWorking` | This OpenCode conversation is closed or already working. |
| `assistant.opencode.messageNotAcknowledged` | OpenCode did not acknowledge the message. |
| `assistant.opencode.modelDefinitionUnavailable` | OpenCode could not load the configured model definition. Check the selected integration before sending. |
| `assistant.opencode.nativeStillWorking` | The native OpenCode conversation is still working. Stop or inspect it before sending another message. |
| `assistant.opencode.noTurnToSteer` | OpenCode has no active turn to steer. |
| `assistant.opencode.otherAccount` | This conversation belongs to another OpenCode account. Restore that connection or start a new conversation. |
| `assistant.opencode.otherHistoryStore` | This OpenCode conversation belongs to another native history store. Restore its original host configuration. |
| `assistant.opencode.otherHistoryStoreOrRuntime` | This OpenCode conversation belongs to another native history store or runtime. Restore its original host configuration. |
| `assistant.opencode.otherWorkingDirectory` | This OpenCode conversation belongs to another working directory or native state directory. Restore its original host configuration. |
| `assistant.opencode.reasoningEffortUnsupported` | The selected OpenCode model does not support this reasoning effort. |
| `assistant.opencode.reopenTerminalToAttach` | Reopen the OpenCode terminal before attaching files. |
| `assistant.opencode.savedConversationUnavailable` | The saved OpenCode conversation is unavailable. Restore its native history before continuing. |
| `assistant.opencode.turnFailed` | OpenCode turn failed. |
| `assistant.opencode.turnUnreadable` | The exact OpenCode turn did not produce a readable result. |
| `assistant.opencode.turnNotFinished` | OpenCode did not finish the turn. |
| `conversation_claude_turn_timeout` | Claude did not finish within the time limit. |
| `conversation_claude_renewal_history_mismatch` | The Claude renewal conversation does not match the expected native history. |
| `conversation_claude_renewal_unrelated_history` | The successor Claude conversation already contains unrelated messages. |
| `conversation_claude_renewal_turn_active` | Stop the current turn before renewing this conversation. |
| `conversation_claude_unavailable` | This Claude conversation is unavailable. |
| `conversation_claude_retained_goal_invalid` | The retained Claude goal is invalid. Restore its saved conversation state. |
| `conversation_claude_retained_goal_conflict` | The saved Claude goal cannot be both paused and blocked. |
| `conversation_claude_session_closing` | This session is closing. |
| `conversation_claude_preparation_stopped` | Claude preparation was stopped while this session was closing or changing. |
| `conversation_claude_terminal_turn_active` | Stop the current turn before opening the Claude Code terminal. |
| `conversation_claude_still_working` | This conversation is still working. |
| `conversation_claude_history_retire_busy` | Stop the saved Claude process and its terminal before retiring native history. |
| `conversation_claude_message_required` | Enter a message for Claude. |
| `conversation_claude_command_stopped` | The goal command was stopped before delivery. |
| `conversation_claude_context_usage_unavailable` | Claude's current context usage is unavailable. |
| `conversation_claude_goal_clear_unconfirmed` | Claude has not saved the retained goal's native clear receipt. |
| `conversation_claude_saved_state_unreadable` | The saved Claude conversation {conversationId} is unreadable. Restore its saved conversation state. |
| `conversation_tool_not_executed` | Execution stopped before the action began. |
| `conversation_tool_outcome_unknown` | The application operation did not return a verified result. Inspect its target before requesting another execution. |
| `conversation_unsupported` | This original scoped conversation has no canonical message or goal receipt. |
| `assistant_claude_goal_attachment_pending` | Claude accepted the goal command, but its goal attachment is not available yet. Check its original receipt before trying again. |
| `assistant_claude_admission_unknown` | Claude has not acknowledged this prompt. Its delivery is uncertain. |
| `assistant_claude_startup_exited` | Claude exited before initialization completed. |
| `claude_stop_unconfirmed` | Claude process cleanup could not be confirmed. Restore its execution host before continuing. |
| `claude_account_changed` | This conversation belongs to another Claude account. Reconnect that account or start a new session. |
| `assistant_opencode_recovery_order_unconfirmed` | OpenCode could not confirm that the new input follows its final-answer recovery. The admitted message was not resent. |
| `assistant_opencode_interrupt_unconfirmed` | OpenCode did not confirm Stop. Try Stop again. |
| `assistant_opencode_interrupt_timeout` | OpenCode did not confirm Stop within 5 seconds. Try Stop again. |
| `assistant_opencode_key_verification_unavailable` | OpenCode API-key verification could not run. |
| `assistant_opencode_stop_unverified` | OpenCode process exit could not be verified. |
| `assistant_opencode_connection_reload_failed` | OpenCode could not load the changed AI connection for this work. Send your message again. |
| `assistant_opencode_response_too_large` | OpenCode returned more data than the bridge accepts. |
| `assistant_opencode_event_too_large` | An OpenCode event exceeded the bridge limit. |
| `assistant_opencode_directory_unavailable` | OpenCode did not confirm its conversation directory is ready. |
| `assistant_opencode_catalog_invalid` | OpenCode returned an invalid provider catalogue. |
| `assistant_opencode_catalog_stop_failed` | The temporary OpenCode catalogue process did not stop cleanly. |
| `assistant_opencode_events_timeout` | OpenCode's event connection did not become ready. |
| `assistant_opencode_observation_lost` | OpenCode's event connection ended before observation was closed. |
| `assistant_opencode_parent_unverified` | The subagent's parent session could not be verified. |
| `assistant_opencode_start_timeout` | OpenCode did not become ready before the startup deadline. |
| `assistant_opencode_version_mismatch` | OpenCode {installed} is installed; this host requires {required}. |
| `assistant_opencode_zen_catalog_unavailable` | OpenCode Zen's current model list could not be read. Try again. |
| `assistant_agent_control_binding_retained` | Another native subscriber retained the previous assistant settings. Close the native assistant terminal and retry Resume. |
| `assistant_codex_provider_binding_retained` | Another native subscriber retained the previous model provider. Close the native assistant terminal and retry. |
| `assistant_codex_provider_switch_busy` | Stop the current turn before immediately changing model providers. |
| `assistant_codex_history_request_too_large` | Codex history exceeds the adapter request limit. |
| `assistant_codex_history_request_unreadable` | Codex sent an unreadable or oversized history request. |
| `assistant_codex_app_server_message_too_large` | Codex app-server message exceeded the configured transport limit. |
| `codex_reconnect_required` | Sign in with codex login before continuing. |
| `codex_provider_connection_changed` | This Codex provider connection changed. Work is stopped; use Send or Resume after reconnecting. |
| `codex_runtime_invalidated` | Codex's native runtime was invalidated. |
| `assistant_provider_fetch_missing` | Global fetch is not available for anthropic provider. |
| `assistant_tool_arguments_invalid` | Tool arguments must be a JSON object. |
| `assistant_tool_result_unserializable` | Tool result could not be serialized. |
| `assistant_tool_result_too_large` | Tool result exceeds the assistant size limit. Narrow the request and try again. |
| `assistant_tool_contract_too_large` | Action contract exceeds the assistant size limit. Narrow the request and try again. |
| `assistant_tool_arguments_too_large` | Tool arguments exceed the assistant size limit. Narrow the request and try again. |
| `assistant_action_cursor_invalid` | Action search cursor is invalid for this query. |
| `assistant_action_unknown` | Action is not available. |
| `assistant_action_contract_required` | Load this action's exact contract before executing it. |
| `assistant_tool_output_invalid` | Assistant tool output validation failed. |
| `assistant_tool_unknown` | Unknown tool. |
| `assistant_claude_control_timeout` | Claude {request} timed out. |
| `assistant_custom_endpoint_unreachable` | Your model server at {upstream} isn't answering. Start it, then send your message again. |

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".
- `failure(message, code, statusCode, { messageCode, messageParams })`; a non-AppError before streaming now reports `request_failed` (or `internal_server_error`) instead of `app_error`.

### Upgrading

- NDJSON error events (`mapStreamError`) also carry `params`, `messageCode` and `messageParams` when the error has them.

### New message keys (331)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.assistant.api.requestFailed`
- `jskit.assistant.attachments.announcement.cancelled`
- `jskit.assistant.attachments.announcement.inProgress`
- `jskit.assistant.attachments.announcement.needAttention`
- `jskit.assistant.attachments.announcement.ready`
- `jskit.assistant.attachments.attached`
- `jskit.assistant.attachments.bytes`
- `jskit.assistant.attachments.bytesPercent`
- `jskit.assistant.attachments.cancelItem`
- `jskit.assistant.attachments.close`
- `jskit.assistant.attachments.download`
- `jskit.assistant.attachments.error.cleanupFailed`
- `jskit.assistant.attachments.error.localFilePaste`
- `jskit.assistant.attachments.error.noFile`
- `jskit.assistant.attachments.error.preparationFailed`
- `jskit.assistant.attachments.error.tooLarge`
- `jskit.assistant.attachments.error.tooMany`
- `jskit.assistant.attachments.error.unusable`
- `jskit.assistant.attachments.error.uploadFailed`
- `jskit.assistant.attachments.limit`
- `jskit.assistant.attachments.preparingName`
- `jskit.assistant.attachments.previewUnavailable`
- `jskit.assistant.attachments.queue`
- `jskit.assistant.attachments.removeItem`
- `jskit.assistant.attachments.retryItem`
- `jskit.assistant.attachments.sizeBytes`
- `jskit.assistant.attachments.sizeKilobytes`
- `jskit.assistant.attachments.sizeMebibytes`
- `jskit.assistant.attachments.sizeMegabytes`
- `jskit.assistant.attachments.status.cancelled`
- `jskit.assistant.attachments.status.delivering`
- `jskit.assistant.attachments.status.preparationFailed`
- `jskit.assistant.attachments.status.preparing`
- `jskit.assistant.attachments.status.queued`
- `jskit.assistant.attachments.status.ready`
- `jskit.assistant.attachments.status.sendingFailed`
- `jskit.assistant.attachments.status.uploadFailed`
- `jskit.assistant.attachments.status.uploading`
- `jskit.assistant.attachments.summary.cancelled`
- `jskit.assistant.attachments.summary.inProgress`
- `jskit.assistant.attachments.summary.needAttention`
- `jskit.assistant.attachments.summary.percent`
- `jskit.assistant.attachments.summary.ready`
- `jskit.assistant.attachments.unnamed`
- `jskit.assistant.attachments.uploadProgress`
- `jskit.assistant.chat.attachFiles`
- `jskit.assistant.chat.avatar`
- `jskit.assistant.chat.discardUnsent`
- `jskit.assistant.chat.editUnsent`
- `jskit.assistant.chat.label`
- `jskit.assistant.chat.messageAssistant`
- `jskit.assistant.chat.minimiseAvatar`
- `jskit.assistant.chat.reviewAttachedFiles`
- `jskit.assistant.chat.sendingToAssistant`
- `jskit.assistant.chat.showAvatar`
- `jskit.assistant.chat.working`
- `jskit.assistant.composer.cannotSendYet`
- `jskit.assistant.composer.chatChanged`
- `jskit.assistant.composer.notReady`
- `jskit.assistant.composer.send`
- `jskit.assistant.composer.sendMessage`
- `jskit.assistant.composer.sending`
- `jskit.assistant.composer.stop`
- `jskit.assistant.composer.stopping`
- `jskit.assistant.composer.suggestedPrompts`
- `jskit.assistant.composer.suggestionsAvailable`
- `jskit.assistant.composer.thinkingOfIdeas`
- `jskit.assistant.composer.thinkingOfIdeasStatus`
- `jskit.assistant.composer.useSuggestion`
- `jskit.assistant.delivery.checkBeforeResend`
- `jskit.assistant.delivery.checkPrevious`
- `jskit.assistant.delivery.checking`
- `jskit.assistant.delivery.notConfirmed`
- `jskit.assistant.delivery.notSent`
- `jskit.assistant.delivery.retry`
- `jskit.assistant.delivery.retryCheck`
- `jskit.assistant.delivery.unconfirmed`
- `jskit.assistant.delivery.unconfirmedShort`
- `jskit.assistant.goal.blocked`
- `jskit.assistant.goal.budgetLimited`
- `jskit.assistant.goal.cancel`
- `jskit.assistant.goal.cancelInterruptsTurn`
- `jskit.assistant.goal.cancelRemovesGoal`
- `jskit.assistant.goal.cancelling`
- `jskit.assistant.goal.complete`
- `jskit.assistant.goal.elapsed`
- `jskit.assistant.goal.elapsedSinceStart`
- `jskit.assistant.goal.goal`
- `jskit.assistant.goal.loading`
- `jskit.assistant.goal.objective`
- `jskit.assistant.goal.pause`
- `jskit.assistant.goal.pauseInterruptsTurn`
- `jskit.assistant.goal.pausePreventsTurns`
- `jskit.assistant.goal.paused`
- `jskit.assistant.goal.pausing`
- `jskit.assistant.goal.resume`
- `jskit.assistant.goal.resuming`
- `jskit.assistant.goal.running`
- `jskit.assistant.goal.runningTime`
- `jskit.assistant.goal.set`
- `jskit.assistant.goal.start`
- `jskit.assistant.goal.starting`
- `jskit.assistant.goal.tokenBudget`
- `jskit.assistant.goal.unavailable`
- `jskit.assistant.goal.usageLimited`
- `jskit.assistant.longText.details`
- `jskit.assistant.longText.table`
- `jskit.assistant.model.apply`
- `jskit.assistant.model.applying`
- `jskit.assistant.model.chooseAi`
- `jskit.assistant.model.chooseModel`
- `jskit.assistant.model.controls`
- `jskit.assistant.model.loading`
- `jskit.assistant.model.model`
- `jskit.assistant.model.noMatchingModels`
- `jskit.assistant.model.noModels`
- `jskit.assistant.model.noneConfigured`
- `jskit.assistant.model.provider`
- `jskit.assistant.model.selector`
- `jskit.assistant.model.thinking`
- `jskit.assistant.model.tryAgain`
- `jskit.assistant.model.viewOnly`
- `jskit.assistant.model.waitBeforeChanging`
- `jskit.assistant.progress.hide`
- `jskit.assistant.progress.showAll`
- `jskit.assistant.progress.showLatest`
- `jskit.assistant.questions.answerNormally`
- `jskit.assistant.questions.answerRequired`
- `jskit.assistant.questions.fieldLabel`
- `jskit.assistant.questions.label`
- `jskit.assistant.questions.suggestedAnswers`
- `jskit.assistant.settings.readOnly`
- `jskit.assistant.transcript.assistant`
- `jskit.assistant.transcript.cancel`
- `jskit.assistant.transcript.edit`
- `jskit.assistant.transcript.failed`
- `jskit.assistant.transcript.history`
- `jskit.assistant.transcript.loadOlder`
- `jskit.assistant.transcript.loading`
- `jskit.assistant.transcript.loadingOlder`
- `jskit.assistant.transcript.messages`
- `jskit.assistant.transcript.pending`
- `jskit.assistant.transcript.pendingReason`
- `jskit.assistant.transcript.preparing`
- `jskit.assistant.transcript.progress`
- `jskit.assistant.transcript.readMore`
- `jskit.assistant.transcript.recommended`
- `jskit.assistant.transcript.reload`
- `jskit.assistant.transcript.reloading`
- `jskit.assistant.transcript.reloadingShort`
- `jskit.assistant.transcript.reviewMessage`
- `jskit.assistant.transcript.showLess`
- `jskit.assistant.transcript.status`
- `jskit.assistant.turn.failed`
- `jskit.assistant.turn.stopped`
- `jskit.assistant.conversation.handleClosed`
- `jskit.assistant.conversation.handleDisposed`
- `jskit.assistant.conversation.runtimeClosed`
- `jskit.assistant.conversation.pagedHistoryUnsupported`
- `jskit.assistant.conversation.completedEnvelopesNeedNativeOwner`
- `jskit.assistant.conversation.completedEnvelopesNotOwned`
- `jskit.assistant.conversation.goalAttachmentContentUnsupported`
- `jskit.assistant.conversation.originalSendOnly`
- `jskit.assistant.conversation.attachmentIdsOnly`
- `jskit.assistant.conversation.attachmentsNotConfigured`
- `jskit.assistant.conversation.steeringUnsupported`
- `jskit.assistant.conversation.goalsUnsupported`
- `jskit.assistant.conversation.goalTokenBudgetsUnsupported`
- `jskit.assistant.conversation.goalCommandUnsupported`
- `jskit.assistant.conversation.goalAttachmentsUnsupported`
- `jskit.assistant.conversation.completedEnvelopesNeedNativeEngine`
- `jskit.assistant.conversation.replacementPolicyRetained`
- `jskit.assistant.conversation.selectedProfileRetained`
- `jskit.assistant.conversation.hostSelectionRequired`
- `jskit.assistant.conversation.liveSettingsUnsupported`
- `jskit.assistant.conversation.completedEnvelopesNeedStorage`
- `jskit.assistant.conversation.originalReadOnly`
- `jskit.assistant.conversation.authorizedSelectionRequired`
- `jskit.assistant.conversation.eventDeliveryRetained`
- `jskit.assistant.conversation.engineChanged`
- `jskit.assistant.conversation.useReplaceForEngine`
- `jskit.assistant.conversation.rewindInspectionBeforeOpen`
- `jskit.assistant.conversation.rewindInspectionBeforeReplace`
- `jskit.assistant.conversation.responseOwnerChanged`
- `jskit.assistant.conversation.newerResponseOwnsWorker`
- `jskit.assistant.conversation.responseIdentityChanged`
- `jskit.assistant.conversation.applicationToolMessageStale`
- `jskit.assistant.conversation.nativeCompletionMessageStale`
- `jskit.assistant.conversation.toolObservationRetired`
- `jskit.assistant.conversation.toolObservationReceiptLost`
- `jskit.assistant.conversation.waitForNativeResponse`
- `jskit.assistant.conversation.waitForAnswer`
- `jskit.assistant.conversation.waitForTurnSaving`
- `jskit.assistant.conversation.waitForInstructionAdmission`
- `jskit.assistant.conversation.waitForGoalCommand`
- `jskit.assistant.conversation.waitForSubmission`
- `jskit.assistant.conversation.stopBeforeReplace`
- `jskit.assistant.conversation.stopBeforeSettings`
- `jskit.assistant.conversation.completedResponseNoReceipt`
- `jskit.assistant.conversation.completedResponseNoTurnReceipt`
- `jskit.assistant.conversation.completedClaudeNoToolEvidence`
- `jskit.assistant.conversation.responseAssociationUnverified`
- `jskit.assistant.conversation.responseOtherOperation`
- `jskit.assistant.conversation.completedResponseNoPlainReply`
- `jskit.assistant.conversation.completedReplyNoTarget`
- `jskit.assistant.conversation.publishedReplyChanged`
- `jskit.assistant.conversation.replyTargetUsed`
- `jskit.assistant.conversation.operationResponseIdentity`
- `jskit.assistant.conversation.plainReplyPublished`
- `jskit.assistant.conversation.savedOperationChanged`
- `jskit.assistant.conversation.turnFinishedBeforeSend`
- `jskit.assistant.conversation.noActiveTurnToSteer`
- `jskit.assistant.conversation.briefingBeforeTerminal`
- `jskit.assistant.conversation.briefingBeforeGoal`
- `jskit.assistant.conversation.briefingBeforeReplacement`
- `jskit.assistant.conversation.historyExclusionsInvalid`
- `jskit.assistant.conversation.messageContentRequired`
- `jskit.assistant.conversation.steerNotBoolean`
- `jskit.assistant.conversation.applicationDataInvalid`
- `jskit.assistant.conversation.goalMessageIdRequired`
- `jskit.assistant.conversation.goalConversationChanged`
- `jskit.assistant.conversation.goalNeedsNativeConversation`
- `jskit.assistant.conversation.messageIdExclusionsConflict`
- `jskit.assistant.conversation.messageIdContentConflict`
- `jskit.assistant.conversation.completedClaudeNotSteerable`
- `jskit.assistant.conversation.replacementPendingBeforeSend`
- `jskit.assistant.conversation.replacementPendingBeforeRecovery`
- `jskit.assistant.conversation.replacementUnfinished`
- `jskit.assistant.conversation.replacementPendingBeforeSettings`
- `jskit.assistant.conversation.retainedDeliveryUncertain`
- `jskit.assistant.conversation.previousInstructionUnchecked`
- `jskit.assistant.conversation.previousSubmissionUncertain`
- `jskit.assistant.conversation.goalCommandDeliveryUncertain`
- `jskit.assistant.conversation.earlierGoalCommandUnresolved`
- `jskit.assistant.conversation.pendingDeliveryBeforeReplace`
- `jskit.assistant.conversation.deliveryUncertainBeforeSettings`
- `jskit.assistant.conversation.goalActionRequired`
- `jskit.assistant.conversation.goalObjectiveInvalid`
- `jskit.assistant.conversation.goalToResumeRequired`
- `jskit.assistant.conversation.goalToStopRequired`
- `jskit.assistant.conversation.replacementRequestInvalid`
- `jskit.assistant.conversation.replacementBriefingRequired`
- `jskit.assistant.conversation.predecessorChanged`
- `jskit.assistant.conversation.replacementOperationConflict`
- `jskit.assistant.conversation.replacementChangedBeforeWrite`
- `jskit.assistant.conversation.replacementChangedBeforeRelease`
- `jskit.assistant.conversation.predecessorChangedBeforeRelease`
- `jskit.assistant.conversation.predecessorIncomplete`
- `jskit.assistant.conversation.hostScopeMismatch`
- `jskit.assistant.conversation.cleanupNeedsOriginalConversation`
- `jskit.assistant.conversation.deliveryUnconfirmed`
- `jskit.assistant.conversation.messageNotSent`
- `jskit.assistant.conversation.attachmentIdsInvalid`
- `jskit.assistant.conversation.attachmentResolverIncomplete`
- `jskit.assistant.conversation.attachmentLocalFilesUnsupported`
- `jskit.assistant.conversation.attachmentReceiptInvalid`
- `jskit.assistant.conversation.attachmentLocalFileInvalid`
- `jskit.assistant.conversation.attachmentFormatUnsupported`
- `jskit.assistant.conversation.attachmentTextEmpty`
- `jskit.assistant.conversation.attachmentBytesRequired`
- `jskit.assistant.conversation.attachmentBytesExceeded`
- `jskit.assistant.conversation.replacementRetryMismatch`
- `jskit.assistant.conversation.previousReplacementUnfinished`
- `jskit.assistant.conversation.previousReleaseUndoUnfinished`
- `jskit.assistant.conversation.pendingDeliveryBeforeContextReplace`
- `jskit.assistant.conversation.shutdownUnconfirmed`
- `jskit.assistant.conversation.submissionInterrupted`
- `jskit.assistant.conversation.restartInterrupted`
- `jskit.assistant.conversation.copiedInterrupted`
- `jskit.assistant.conversation.operationResultUnsaved`
- `jskit.assistant.conversation.progressUnsaved`
- `jskit.assistant.conversation.requestTimedOut`
- `jskit.assistant.conversation.workStopped`
- `jskit.assistant.conversation.stoppedByUser`
- `jskit.assistant.conversation.apiHistoryLimit`
- `jskit.assistant.conversation.outputTokenLimit`
- `jskit.assistant.conversation.toolCallsUnconfirmed`
- `jskit.assistant.conversation.answerUnconfirmed`
- `jskit.assistant.conversation.toolProgressLimit`
- `jskit.assistant.conversation.finalReplyLimit`
- `jskit.assistant.conversation.historyBudgetExceeded`
- `jskit.assistant.conversation.briefingBudgetExceeded`
- `jskit.assistant.claude.goalChanged`
- `jskit.assistant.claude.goalTokenBudgetUnsupported`
- `jskit.assistant.claude.goalBlockerReasonRequired`
- `jskit.assistant.claude.goalConditionRequired`
- `jskit.assistant.claude.goalAlreadySet`
- `jskit.assistant.claude.goalActionUnknown`
- `jskit.assistant.claude.compactWhileWorking`
- `jskit.assistant.claude.noActiveTurn`
- `jskit.assistant.claude.steeringUnavailable`
- `jskit.assistant.claude.notConnected`
- `jskit.assistant.claude.accountStatusInvalid`
- `jskit.assistant.codex.helperThreadUnavailable`
- `jskit.assistant.codex.helperOwnershipBlocked`
- `jskit.assistant.codex.threadDeleteUnavailable`
- `jskit.assistant.codex.goalActionInvalid`
- `jskit.assistant.codex.goalObjectiveInvalid`
- `jskit.assistant.codex.goalConversationChanged`
- `jskit.assistant.codex.goalConversationStopped`
- `jskit.assistant.codex.goalChangedBeforeSet`
- `jskit.assistant.codex.goalChanged`
- `jskit.assistant.codex.goalAlreadyStopped`
- `jskit.assistant.codex.goalStopUnconfirmed`
- `jskit.assistant.codex.goalNotResumable`
- `jskit.assistant.codex.stopUnverified`
- `jskit.assistant.codex.turnNotReady`
- `jskit.assistant.codex.messageEmpty`
- `jskit.assistant.codex.messageInputEmpty`
- `jskit.assistant.codex.operationNotSteerable`
- `jskit.assistant.codex.temporaryConversationBusy`
- `jskit.assistant.provider.notConfigured`
- `jskit.assistant.provider.requestFailed`
- `jskit.assistant.provider.requestRejected`
- `jskit.assistant.stream.failed`
- `jskit.assistant.stream.requestFailed`
- `jskit.errors.conversation_forbidden`
- `jskit.errors.conversation_storage_version`
- `jskit.errors.conversation_configuration_mismatch`
- `jskit.errors.conversation_goal_stopped`
- `jskit.errors.conversation_attachment_manifest_changed`
- `jskit.errors.conversation_receipt_unavailable`
- `jskit.errors.conversation_goal_unavailable`
- `jskit.errors.assistant_provider_invalid_response`
- `jskit.errors.assistant_opencode_connection_changing`
- `jskit.errors.assistant_opencode_connection_in_use`
- `jskit.errors.assistant_opencode_conversation_busy`
- `jskit.errors.assistant_opencode_key_verification_failed`
- `jskit.errors.assistant_opencode_turn_thread_mismatch`
- `jskit.errors.assistant_opencode_turn_fresh_thread_required`
- `jskit.errors.assistant_opencode_turn_unrelated_history`

</details>

### Codes (182)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `assistant.api.requestFailed` | Assistant request failed. |
| `assistant.attachments.error.noFile` | The prepared attachment did not produce a file. |
| `assistant.composer.cannotSendYet` | Your words are in the chat box, but this conversation cannot send yet. |
| `assistant.composer.chatChanged` | The chat changed before sending. Review the draft before sending. |
| `assistant.composer.notReady` | The chat composer is not ready yet. |
| `assistant.longText.details` | Details |
| `assistant.questions.answerRequired` | Answer question {number}. |
| `assistant.turn.failed` | Assistant stopped with an error. |
| `assistant.turn.stopped` | Stopped. |
| `assistant.conversation.handleClosed` | This conversation handle is closed. |
| `assistant.conversation.handleDisposed` | This conversation handle is disposed. |
| `assistant.conversation.runtimeClosed` | This conversation runtime is closed. |
| `assistant.conversation.pagedHistoryUnsupported` | This conversation does not supply paged history. |
| `assistant.conversation.completedEnvelopesNeedNativeOwner` | Completed envelopes require a runtime-owned native conversation. |
| `assistant.conversation.completedEnvelopesNotOwned` | This conversation does not own completed envelopes. |
| `assistant.conversation.goalAttachmentContentUnsupported` | Native goals require extracted text or supported image bytes for attachments. |
| `assistant.conversation.originalSendOnly` | This conversation supports its original application Send operation. |
| `assistant.conversation.attachmentIdsOnly` | Supply attachmentIds; only the application's resolver can supply file content. |
| `assistant.conversation.attachmentsNotConfigured` | File attachments are not configured for this conversation. |
| `assistant.conversation.steeringUnsupported` | This connection does not support steering. |
| `assistant.conversation.goalsUnsupported` | This connection does not support native goals. |
| `assistant.conversation.goalTokenBudgetsUnsupported` | This connection does not support goal token budgets. |
| `assistant.conversation.goalCommandUnsupported` | This connection does not support that goal command. |
| `assistant.conversation.goalAttachmentsUnsupported` | This engine's native goal commands do not accept attachments. |
| `assistant.conversation.completedEnvelopesNeedNativeEngine` | Completed envelopes require a native engine. |
| `assistant.conversation.replacementPolicyRetained` | This conversation retains its original replacement policy. |
| `assistant.conversation.selectedProfileRetained` | This scoped conversation retains its original selected profile. |
| `assistant.conversation.hostSelectionRequired` | This host requires its authorized assistant selection operation. |
| `assistant.conversation.liveSettingsUnsupported` | This provider does not support live native settings. |
| `assistant.conversation.completedEnvelopesNeedStorage` | Completed envelopes require runtime-owned canonical storage. |
| `assistant.conversation.originalReadOnly` | This conversation uses its original read and subscription operations. |
| `assistant.conversation.authorizedSelectionRequired` | Use the conversation's authorized selection operation. |
| `assistant.conversation.eventDeliveryRetained` | This scoped conversation retains its original event delivery. |
| `assistant.conversation.engineChanged` | The selected native engine changed. |
| `assistant.conversation.useReplaceForEngine` | Use replace() to change this conversation's engine. |
| `assistant.conversation.rewindInspectionBeforeOpen` | This conversation has an unfinished Undo operation from an earlier runtime. Inspect its saved native and local history offline before opening it; no history was changed. |
| `assistant.conversation.rewindInspectionBeforeReplace` | This conversation has an unfinished Undo operation from an earlier runtime. Inspect its saved native and local history offline before replacing it; no history was changed. |
| `assistant.conversation.responseOwnerChanged` | The completed response owner changed. |
| `assistant.conversation.newerResponseOwnsWorker` | A newer completed response owns this worker. |
| `assistant.conversation.responseIdentityChanged` | The completed response identity changed. |
| `assistant.conversation.applicationToolMessageStale` | This application tool's admitted message is no longer current. |
| `assistant.conversation.nativeCompletionMessageStale` | This native completion's admitted message is no longer current. |
| `assistant.conversation.toolObservationRetired` | The native tool observation belongs to a retired response. |
| `assistant.conversation.toolObservationReceiptLost` | The native tool observation lost its exact admitted receipt. |
| `assistant.conversation.waitForNativeResponse` | Wait for the native response to finish. |
| `assistant.conversation.waitForAnswer` | Wait for this answer or use steer to send another instruction. |
| `assistant.conversation.waitForTurnSaving` | Wait for the current turn to finish saving before starting the goal. |
| `assistant.conversation.waitForInstructionAdmission` | Wait for the pending instruction to be admitted before steering again. |
| `assistant.conversation.waitForGoalCommand` | Wait for the goal command to be admitted. |
| `assistant.conversation.waitForSubmission` | Wait for the current submission before checking delivery. |
| `assistant.conversation.stopBeforeReplace` | Stop the current turn before replacing its native conversation. |
| `assistant.conversation.stopBeforeSettings` | Stop the current turn before changing its settings. |
| `assistant.conversation.completedResponseNoReceipt` | The completed response has no current verified receipt. |
| `assistant.conversation.completedResponseNoTurnReceipt` | The completed response has no exact native turn receipt. |
| `assistant.conversation.completedClaudeNoToolEvidence` | The completed Claude response has no native tool-attempt evidence. |
| `assistant.conversation.responseAssociationUnverified` | The native owner could not verify this response association. |
| `assistant.conversation.responseOtherOperation` | This response already belongs to a different application operation. |
| `assistant.conversation.completedResponseNoPlainReply` | This completed response does not own a plain reply. |
| `assistant.conversation.completedReplyNoTarget` | The completed reply has no current plain authored target. |
| `assistant.conversation.publishedReplyChanged` | The published reply target or text changed. |
| `assistant.conversation.replyTargetUsed` | This plain reply target already has unassociated content or consumption. |
| `assistant.conversation.operationResponseIdentity` | The operation has a different completed response identity. |
| `assistant.conversation.plainReplyPublished` | This completed response already published its plain reply. |
| `assistant.conversation.savedOperationChanged` | The saved response operation changed. |
| `assistant.conversation.turnFinishedBeforeSend` | The native turn finished before this instruction was sent. Send it as a new message. |
| `assistant.conversation.noActiveTurnToSteer` | There is no active native turn to steer. Send a new message. |
| `assistant.conversation.briefingBeforeTerminal` | Send a chat message to deliver the saved continuity briefing before starting a native terminal or goal. |
| `assistant.conversation.briefingBeforeGoal` | Send a message to catch this AI up before starting or resuming its goal. |
| `assistant.conversation.briefingBeforeReplacement` | Deliver the previous replacement's briefing before replacing native history again. |
| `assistant.conversation.historyExclusionsInvalid` | Native history exclusions require a server-owned completed application wake and exact message IDs. |
| `assistant.conversation.messageContentRequired` | Bounded text or attachment IDs and a stable messageId are required. |
| `assistant.conversation.steerNotBoolean` | steer must be a boolean. |
| `assistant.conversation.applicationDataInvalid` | Application data must be a JSON object within the conversation input limit. |
| `assistant.conversation.goalMessageIdRequired` | A stable messageId is required for this goal command. |
| `assistant.conversation.goalConversationChanged` | The conversation changed before this goal command was sent. |
| `assistant.conversation.goalNeedsNativeConversation` | This command requires an existing native conversation. |
| `assistant.conversation.messageIdExclusionsConflict` | This messageId already belongs to different native history exclusions. |
| `assistant.conversation.messageIdContentConflict` | This messageId already belongs to different content. |
| `assistant.conversation.completedClaudeNotSteerable` | Completed Claude responses cannot share a native steering turn. Wait for the response or stop it. |
| `assistant.conversation.replacementPendingBeforeSend` | Finish the pending native replacement before sending another message. |
| `assistant.conversation.replacementPendingBeforeRecovery` | Finish the native replacement before recovering output. |
| `assistant.conversation.replacementUnfinished` | Retry the unfinished native replacement before starting another one. |
| `assistant.conversation.replacementPendingBeforeSettings` | Finish the pending native replacement before changing settings. |
| `assistant.conversation.retainedDeliveryUncertain` | This message has uncertain delivery in a retained conversation. Select that engine and check its receipt before submitting it again. |
| `assistant.conversation.previousInstructionUnchecked` | Check delivery of the previous instruction before preparing another completed response. |
| `assistant.conversation.previousSubmissionUncertain` | The previous submission has uncertain delivery. It will not be resent automatically. |
| `assistant.conversation.goalCommandDeliveryUncertain` | Check the uncertain command's delivery before changing the goal. |
| `assistant.conversation.earlierGoalCommandUnresolved` | A goal command from an earlier runtime has unresolved delivery. Inspect its saved state before changing the goal. |
| `assistant.conversation.pendingDeliveryBeforeReplace` | Resolve pending delivery before replacing native history. Another engine may be selected while its receipt stays pending. |
| `assistant.conversation.deliveryUncertainBeforeSettings` | Resolve uncertain delivery before changing settings. |
| `assistant.conversation.goalActionRequired` | A goal action and current conversation segment are required. |
| `assistant.conversation.goalObjectiveInvalid` | A bounded objective and optional positive token budget are required. |
| `assistant.conversation.goalToResumeRequired` | Select the goal to resume. |
| `assistant.conversation.goalToStopRequired` | Select the goal to stop. |
| `assistant.conversation.replacementRequestInvalid` | Replacement needs an operationId, exact predecessor segment, and an engine-change, model-change or renewal reason. |
| `assistant.conversation.replacementBriefingRequired` | Native replacement requires a continuity briefing. |
| `assistant.conversation.predecessorChanged` | The native predecessor has changed. Read the conversation before replacing it. |
| `assistant.conversation.replacementOperationConflict` | This replacement operationId already belongs to another request. |
| `assistant.conversation.replacementChangedBeforeWrite` | The saved replacement changed before it could be written. |
| `assistant.conversation.replacementChangedBeforeRelease` | The saved replacement changed before its binding was released. |
| `assistant.conversation.predecessorChangedBeforeRelease` | The native predecessor identity changed before its binding was released. |
| `assistant.conversation.predecessorIncomplete` | The native predecessor identity changed or is incomplete. |
| `assistant.conversation.hostScopeMismatch` | This open conversation already belongs to another host scope. Dispose its handle before reopening it on the original host. |
| `assistant.conversation.cleanupNeedsOriginalConversation` | Native cleanup requires its original bound conversation. |
| `assistant.conversation.deliveryUnconfirmed` | Native delivery could not be confirmed. |
| `assistant.conversation.messageNotSent` | This message was not sent. Review it before sending a new message. |
| `assistant.conversation.attachmentIdsInvalid` | Attachments require at most {max} distinct, nonempty attachment IDs. |
| `assistant.conversation.attachmentResolverIncomplete` | The attachment resolver must return a receipt for every requested file and bounded model content. |
| `assistant.conversation.attachmentLocalFilesUnsupported` | This engine cannot accept local attachment files. Supply extracted text or supported image bytes. |
| `assistant.conversation.attachmentReceiptInvalid` | Attachment receipts require the requested ID, a bounded fileName and a nonnegative size. |
| `assistant.conversation.attachmentLocalFileInvalid` | Local attachment files require their exact requested receipt and an authorized absolute native path. |
| `assistant.conversation.attachmentFormatUnsupported` | This engine cannot accept that attachment format. Supply extracted text or a supported image. |
| `assistant.conversation.attachmentTextEmpty` | Attachment text must be nonempty. |
| `assistant.conversation.attachmentBytesRequired` | Attachments require authorized bytes and a supported media type; remote URLs and paths are not accepted. |
| `assistant.conversation.attachmentBytesExceeded` | Attachment content exceeds the configured byte limit for this request. |
| `assistant.conversation.replacementRetryMismatch` | Replacement retry does not match the saved operation. |
| `assistant.conversation.previousReplacementUnfinished` | Finish the previous native conversation replacement first. |
| `assistant.conversation.previousReleaseUndoUnfinished` | An unfinished conversation Undo from a previous release blocks assistant work. Complete it using the previous release before upgrading. |
| `assistant.conversation.pendingDeliveryBeforeContextReplace` | Finish pending delivery before replacing native context. |
| `assistant.conversation.shutdownUnconfirmed` | Native conversation shutdown was not confirmed. |
| `assistant.conversation.submissionInterrupted` | The previous submission was interrupted. Check delivery before submitting it again. |
| `assistant.conversation.restartInterrupted` | The application restarted before this answer completed. The request was not replayed. |
| `assistant.conversation.copiedInterrupted` | Copied into a stopped development environment. This request was not replayed. |
| `assistant.conversation.operationResultUnsaved` | The application operation result could not be saved. Restore storage access and retry saving. |
| `assistant.conversation.progressUnsaved` | Conversation progress could not be saved. Restore access to its storage before continuing. |
| `assistant.conversation.requestTimedOut` | The conversation request exceeded its time limit. |
| `assistant.conversation.workStopped` | Work stopped. |
| `assistant.conversation.stoppedByUser` | Stopped by user. |
| `assistant.conversation.apiHistoryLimit` | This conversation exceeds the configured API history limit. Start another conversation or increase the limit. |
| `assistant.conversation.outputTokenLimit` | The model reached its output token limit before completing the answer. Increase maxOutputTokens in the conversation limits. |
| `assistant.conversation.toolCallsUnconfirmed` | The model stream ended without confirming its application tool calls. |
| `assistant.conversation.answerUnconfirmed` | The model stream ended without confirming a completed answer. |
| `assistant.conversation.toolProgressLimit` | Application tool progress text exceeds the configured API limit. |
| `assistant.conversation.finalReplyLimit` | The assistant exceeded the configured final reply limit. |
| `assistant.conversation.historyBudgetExceeded` | Conversation updates exceed the configured history budget. Renew the context with a continuity briefing before continuing. |
| `assistant.conversation.briefingBudgetExceeded` | The continuity briefing exceeds the configured history budget. |
| `assistant.claude.goalChanged` | The Claude goal changed. Refresh before trying again. |
| `assistant.claude.goalTokenBudgetUnsupported` | Claude goals do not support a token budget. |
| `assistant.claude.goalBlockerReasonRequired` | An active Claude goal needs a blocker reason of up to 1,000 characters. |
| `assistant.claude.goalConditionRequired` | Enter a goal condition of up to 4,000 characters. |
| `assistant.claude.goalAlreadySet` | Cancel the existing goal before setting another. |
| `assistant.claude.goalActionUnknown` | Unknown Claude goal action. |
| `assistant.claude.compactWhileWorking` | Claude is still working. Wait for it to finish before freeing its context. |
| `assistant.claude.noActiveTurn` | Claude has no active turn for this message. |
| `assistant.claude.steeringUnavailable` | This Claude turn cannot accept steering now. |
| `assistant.claude.notConnected` | Claude Code is not connected. |
| `assistant.claude.accountStatusInvalid` | Claude Code returned an invalid account status. |
| `assistant.codex.helperThreadUnavailable` | This low-cost assistant thread is no longer available. Start the background task again instead of reusing another assistant conversation. |
| `assistant.codex.helperOwnershipBlocked` | {applicationName} could not prove ownership of a persisted low-cost assistant thread. |
| `assistant.codex.threadDeleteUnavailable` | Codex app-server thread deletion is not available. |
| `assistant.codex.goalActionInvalid` | Choose set, pause, resume, or cancel. |
| `assistant.codex.goalObjectiveInvalid` | Enter a goal objective and an optional positive whole-number token budget. |
| `assistant.codex.goalConversationChanged` | The Codex conversation changed. Refresh the goal before trying again. |
| `assistant.codex.goalConversationStopped` | Resume or send a message to restore the stopped conversation before setting a goal. |
| `assistant.codex.goalChangedBeforeSet` | The Codex goal changed. Refresh it before setting a new goal. |
| `assistant.codex.goalChanged` | The Codex goal changed. Refresh it before trying again. |
| `assistant.codex.goalAlreadyStopped` | This goal is already stopped. Refresh its details. |
| `assistant.codex.goalStopUnconfirmed` | Codex has not yet confirmed a stop. Retry after the service has stopped. |
| `assistant.codex.goalNotResumable` | This goal cannot be resumed from its current status. Refresh its details. |
| `assistant.codex.stopUnverified` | Codex's stop could not be verified. Its runtime owner is unavailable. |
| `assistant.codex.turnNotReady` | The active assistant turn is not ready to accept this message yet. |
| `assistant.codex.messageEmpty` | Codex message is empty. |
| `assistant.codex.messageInputEmpty` | Codex message input is empty. |
| `assistant.codex.operationNotSteerable` | The active assistant operation cannot accept messages yet. |
| `assistant.codex.temporaryConversationBusy` | Temporary AI is already working on this conversation. |
| `assistant.provider.notConfigured` | Assistant provider is not configured. |
| `assistant.provider.requestFailed` | Assistant provider request failed. |
| `assistant.provider.requestRejected` | Request failed. |
| `assistant.stream.failed` | Assistant stream failed. |
| `assistant.stream.requestFailed` | Request failed. |
| `conversation_forbidden` | This conversation is not available to this identity. |
| `conversation_storage_version` | This conversation needs its offline runtime-state upgrade before it can be opened. Its saved requests were not replayed or changed. |
| `conversation_configuration_mismatch` | Use configure() to change a saved conversation's settings. |
| `conversation_goal_stopped` | The goal command was stopped before delivery. |
| `conversation_attachment_manifest_changed` | Authorized attachment paths changed after this instruction was prepared. Restore the original files or send a new message. |
| `conversation_receipt_unavailable` | The native receipt has no stored authored message. |
| `conversation_goal_unavailable` | The native goal is unavailable. Try reading its status again. |
| `assistant_provider_invalid_response` | Assistant provider returned an invalid response payload. |
| `assistant_opencode_connection_changing` | OpenCode is changing a connection. Retry after the connection change finishes. |
| `assistant_opencode_connection_in_use` | Close the other OpenCode conversations that use this connection, then retry this connection change. The saved connection has not changed. |
| `assistant_opencode_conversation_busy` | This conversation is still working. |
| `assistant_opencode_key_verification_failed` | OpenCode rejected the API-key verification request. |
