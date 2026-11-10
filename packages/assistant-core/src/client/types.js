// The values the assistant's client code hands out and receives across files: what its composables and factories
// return, and the contracts an application implements to supply uploads, a goal and a whole conversation.

/** @typedef {ReturnType<typeof import("./conversation/useAssistantAttachments.js").useAssistantAttachments>} AssistantAttachments */
/** @typedef {ReturnType<typeof import("./conversation/useAssistantSuggestions.js").useAssistantSuggestions>} AssistantSuggestions */
/** @typedef {ReturnType<typeof import("./conversation/useAssistantQuestions.js").useAssistantQuestions>} AssistantQuestions */
/** @typedef {ReturnType<typeof import("./conversation/messageDelivery.js").createAssistantMessageDelivery>} AssistantMessageDelivery */
/** @typedef {ReturnType<typeof import("./lib/assistantApi.js").createAssistantApi>} AssistantApi */

/**
 * What the application's storage returns for one uploaded file, completed by the queue with its client id, session
 * and size.
 * @typedef {object} AssistantAttachmentReceipt
 * @property {string} attachmentId
 * @property {string} clientId
 * @property {string} fileName
 * @property {string} sessionId
 * @property {number} size
 */

/**
 * Uploads one file for a session. It returns the stored file's receipt, as a promise, or as `{ promise }` with the
 * `abort()` or `cancel()` that stops the upload.
 * @typedef {(
 *   sessionId: string,
 *   file: File,
 *   options: { onProgress: (progress: unknown, total?: number) => void, signal: AbortSignal }
 * ) => unknown} AssistantAttachmentUpload
 */

/**
 * Deletes an uploaded file no message will send. A response with `ok: false` reports a failed deletion.
 * @typedef {(sessionId: string, attachmentId: string) => unknown} AssistantAttachmentDeletion
 */

/**
 * The goal a conversation is working towards, as AssistantGoalControl shows and changes it.
 * @typedef {object} AssistantGoalState
 * @property {boolean} [enabled] False hides the control's menu and stops its clock.
 * @property {boolean} [loading]
 * @property {boolean} [available] False while the conversation offers no goals.
 * @property {string} [action] "set" while a new goal is starting.
 * @property {boolean} [working]
 * @property {boolean} [pending]
 * @property {boolean} [stopPending]
 * @property {boolean} [pauseBlocked] True when a goal that is not running (blocked, or waiting at its usage limit) can still be paused.
 * @property {boolean} [pauseInterruptsTurn]
 * @property {boolean} [cancelInterruptsTurn]
 * @property {boolean} [tokenBudgetSupported]
 * @property {string} [error]
 * @property {{ status: string, objective?: string, elapsedSeconds?: number, sampledAt?: number, createdAt?: string } | null} [goal]
 * @property {((input: { objective: string, tokenBudget?: number }) => unknown) | null} [set]
 *   Starts a goal; absent while starting one is not allowed, so Start stays disabled.
 * @property {() => unknown} [pause]
 * @property {() => unknown} [resume]
 * @property {() => unknown} [cancel]
 */

/**
 * What an application supplies to AssistantConversationElement. Only `conversation` is required; each other part
 * adds its controls when present.
 * @typedef {object} AssistantConversationAdapter
 * @property {Record<string, any> & { turns: any[] }} conversation The transcript's props, plus its preview messages
 *   (`previewMessage`, `previewMessages`) and the reply still streaming (`interimReply`).
 * @property {Record<string, any>} [composer] The prompt input's props, plus `draft`, `canSend`, `canStop`,
 *   `stopPending`, `queueWhileSending` and the `payload` every message carries.
 * @property {AssistantConversationActions} [actions]
 * @property {AssistantMessageDelivery} [delivery] Present when the element sends and tracks messages itself.
 * @property {import("vue").UnwrapNestedRefs<AssistantAttachments> & {
 *   enabled?: boolean,
 *   accept?: string,
 *   open?: (attachment: unknown) => void
 * }} [attachments]
 * @property {import("vue").UnwrapNestedRefs<AssistantSuggestions>} [suggestions]
 * @property {import("vue").UnwrapNestedRefs<AssistantQuestions>} [questions]
 * @property {AssistantModelChoices} [models]
 * @property {AssistantGoalState} [goal]
 * @property {{ label: string }} [activity] Replaces the sending and working status line.
 */

/**
 * What the application does for the conversation. The element sends, resends, edits and cancels through its
 * delivery when the application supplies no action of its own; it leaves out the controls of the others.
 * @typedef {object} AssistantConversationActions
 * @property {(draft: string) => void} [setDraft]
 * @property {(input: { configuration: object, attachments: object[] }) => unknown} [submit]
 * @property {(messageId: string) => unknown} [resend]
 * @property {(messageId: string) => unknown} [cancel]
 * @property {(messageId: string) => unknown} [edit]
 * @property {() => unknown} [stop]
 * @property {(messageId: string) => unknown} [checkDelivery]
 * @property {(request: { complete: (result?: { changed?: boolean }) => void }) => unknown} [loadMore]
 * @property {() => unknown} [reload]
 * @property {(link: unknown) => unknown} [openLink]
 * @property {(configuration: object) => unknown} [updateConfiguration]
 */

/**
 * The model menu's rows and choices: AssistantModelControl's props, and what applying or changing them does.
 * @typedef {Record<string, any> & {
 *   enabled?: boolean,
 *   apply: () => unknown,
 *   selectModel?: (modelId: string) => unknown,
 *   selectProvider?: (providerId: string) => unknown,
 *   selectVariant?: (variantId: string) => unknown,
 *   reload?: () => unknown
 * }} AssistantModelChoices
 */

export {};
