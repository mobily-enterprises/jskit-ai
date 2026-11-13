// The type of the `assistant.runtime` capability, the contracts of the optional
// capabilities the assistant runtime reads, and the types its modules share.

/** @typedef {ReturnType<typeof import("./hostedAssistant.js").createHostedAssistant>} HostedAssistant The assistant over a conversation runtime that the application supplies as `assistant.conversations`. */
/** @typedef {ReturnType<typeof import("./createAssistantRuntime.js").createAssistantRuntime>} DatabaseAssistant The assistant over the package's own SQL tables. */
/** @typedef {HostedAssistant | DatabaseAssistant} AssistantRuntime The `assistant.runtime` capability. */

/** @typedef {import("@jskit-ai/assistant-core/server/types").ConversationRuntime} ConversationRuntime The `assistant.conversations` capability: the conversation runtime an application supplies. */
/** @typedef {ReturnType<typeof import("./services/assistantConfigService.js").createService>} AssistantConfigService The `assistant.settings` capability: an assistant surface's saved settings. */
/** @typedef {ReturnType<typeof import("./services/chatService.js").createChatService>} ChatService */
/** @typedef {ReturnType<typeof import("./services/transcriptService.js").createTranscriptService>} TranscriptService */
/** @typedef {ReturnType<typeof import("./createAssistantRuntime.js").createAssistantAiClientFactory>} AssistantAiClientFactory */
/** @typedef {ReturnType<typeof import("./support/createSurfaceAwareToolCatalog.js").createSurfaceAwareToolCatalog>} SurfaceAwareToolCatalog */
/** @typedef {ReturnType<typeof import("./support/personContext.js").createPersonContextPrompt>} PersonContextPrompt A conversation's system prompt with the application's facts about the person. */
/** @typedef {ReturnType<typeof import("./support/turnGuard.js").createTurnAdmission>} TurnAdmission The application's turn guard, held to its contract. */
/** @typedef {ReturnType<typeof import("./sqlConversationStorage.js").createSqlConversationStorage>} SqlConversationStorage The database-backed assistant's conversation storage over its SQL rows. */
/** @typedef {ReturnType<typeof import("./repositories/assistantConfigRepository.js").createRepository>} AssistantConfigRepository */
/** @typedef {ReturnType<typeof import("./repositories/conversationsRepository.js").createRepository>} ConversationsRepository */
/** @typedef {ReturnType<typeof import("./repositories/messagesRepository.js").createRepository>} MessagesRepository */
/** @typedef {ReturnType<typeof import("./repositories/turnRequestsRepository.js").createRepository>} TurnRequestsRepository */
/** @typedef {{ config: AssistantConfigRepository, conversations: ConversationsRepository, messages: MessagesRepository, turnRequests: TurnRequestsRepository }} AssistantRepositories The `assistant.repositories` capability: the database-backed assistant's repositories, which AssistantStoreFeature provides. */

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

/**
 * The `assistant.personContext` capability: stable facts about the person the
 * assistant is talking to (their profile, limitations, preferences), which the
 * assistant always knows. They are part of the conversation's instructions, in
 * their own section after the saved system prompt, never part of its messages.
 *
 * `resolve` must give the same text for the same person and data: a changed text
 * reconfigures the open conversation and restarts the provider's prompt cache. A
 * fact that belongs to one turn (today's readings, a page the person is on) goes
 * into a tool or a message instead. An empty string adds nothing; text past
 * 4000 characters is cut, with a warning logged once per conversation. A throw,
 * or a value that is not a string, fails the turn: the assistant never answers
 * without the facts. The text goes to the AI provider with every request, so it
 * should hold only what the assistant needs.
 * @typedef {object} AssistantPersonContext
 * @property {(request: { targetSurfaceId: string, context: object, workspace: object | null }) => string | Promise<string>} resolve
 *   The facts for the actor in `context` on that surface and workspace.
 */

/**
 * What an application's turn guard decides for one turn: run it, or answer it with this text.
 * @typedef {{ allowed: true } | { reply: string }} AssistantTurnDecision
 */

/**
 * The `assistant.turnGuard` capability: the application's decision on each new turn of the
 * database-backed assistant, made with the person's message before anything is saved or sent
 * and before the AI connection is resolved.
 *
 * `{ allowed: true }` runs the turn as usual. `{ reply }` answers it with that text: the
 * message and the reply are saved and streamed as an ordinary completed turn, and the model is
 * never called. An `AppError` it throws refuses the turn with its status, code and details, and
 * nothing is saved. Any other value is a programming error that fails the turn. A replayed
 * message id never reaches `admit`, but two simultaneous requests with one new message id can
 * both reach it before one of them claims the turn, so a guard that counts turns counts each
 * `messageId` once.
 * @typedef {object} AssistantTurnGuard
 * @property {(request: { targetSurfaceId: string, context: object, input: string, conversationId: string | null, messageId: string }) => AssistantTurnDecision | Promise<AssistantTurnDecision>} admit
 *   The decision for the actor in `context` sending `input` as `messageId`, in the conversation
 *   `conversationId` (null for a new one).
 */

export {};
