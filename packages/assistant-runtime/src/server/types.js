// The type of the `assistant.runtime` capability, the contracts of the optional
// capabilities the assistant runtime reads, and the types its modules share.

/** @typedef {ReturnType<typeof import("./hostedAssistant.js").createHostedAssistant>} HostedAssistant The assistant over a conversation runtime that the application supplies as `assistant.conversations`. */
/** @typedef {ReturnType<typeof import("./createAssistantRuntime.js").createAssistantRuntime>} DatabaseAssistant The assistant over the package's own SQL tables. */
/** @typedef {HostedAssistant | DatabaseAssistant} AssistantRuntime The `assistant.runtime` capability. */

/** @typedef {ReturnType<typeof import("@jskit-ai/assistant-core/server/conversation").createConversationRuntime>} ConversationRuntime The `assistant.conversations` capability: the conversation runtime an application supplies. */
/** @typedef {ReturnType<typeof import("./services/assistantConfigService.js").createService>} AssistantConfigService The `assistant.settings` capability: an assistant surface's saved settings. */
/** @typedef {ReturnType<typeof import("./services/chatService.js").createChatService>} ChatService */
/** @typedef {ReturnType<typeof import("./services/transcriptService.js").createTranscriptService>} TranscriptService */
/** @typedef {ReturnType<typeof import("./createAssistantRuntime.js").createAssistantAiClientFactory>} AssistantAiClientFactory */
/** @typedef {ReturnType<typeof import("./support/createSurfaceAwareToolCatalog.js").createSurfaceAwareToolCatalog>} SurfaceAwareToolCatalog */
/** @typedef {ReturnType<typeof import("./repositories/assistantConfigRepository.js").createRepository>} AssistantConfigRepository */
/** @typedef {ReturnType<typeof import("./repositories/conversationsRepository.js").createRepository>} ConversationsRepository */
/** @typedef {ReturnType<typeof import("./repositories/messagesRepository.js").createRepository>} MessagesRepository */
/** @typedef {ReturnType<typeof import("./repositories/turnRequestsRepository.js").createRepository>} TurnRequestsRepository */

/** @typedef {import("@jskit-ai/workspaces-core/server/types").WorkspacesCore["scope"]} WorkspaceScopeSupport The workspace route support of `workspaces.core`: its route params, the action input they build and the workspace an action runs in. */

/**
 * The `assistant.conversation.access` capability: a host's access owner for the
 * conversation routes and actions.
 * @typedef {object} ConversationAccess
 * @property {{ register: import("@jskit-ai/kernel/server/types").RuntimeRouter["register"] }} router Registers a conversation route behind the host's access check.
 * @property {(definition: object) => object} wrapAction Wraps a conversation action definition with the host's access policy.
 * @property {string} subscribeActionId The fixed id of the host's conversation subscription action.
 * @property {"authenticated" | "host"} requestPolicy How a realtime subscription reads its request.
 */

/**
 * The `assistant.attachments` capability: the application's authorized files for
 * a message.
 * @typedef {object} AssistantAttachments
 * @property {(request: { attachmentIds: string[], context: object, workspace: object | null, conversation: object }) => Promise<unknown>} resolve
 */

export {};
