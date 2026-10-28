# Changelog

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
