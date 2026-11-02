// The types of assistant-core's server facilities, for the code that receives them, and the
// contracts of what an application passes the conversation runtime.

/** @typedef {ReturnType<typeof import("./conversation/runtime.js").createConversationRuntime>} ConversationRuntime */
/** @typedef {ReturnType<typeof import("./conversation/transcript.js").createConversationTranscript>} ConversationTranscript */
/** @typedef {ReturnType<typeof import("./conversation/streams.js").createConversationStreams>} ConversationStreams */
/** @typedef {ReturnType<typeof import("./conversation/storage.js").createReentrantConversationStorage>} ReentrantConversationStorage */
/** @typedef {ReturnType<typeof import("./lib/serviceToolCatalog.js").createServiceToolCatalog>} ServiceToolCatalog */
/** @typedef {ReturnType<typeof import("./lib/aiClient.js").createAiClient>} AiClient */
/** @typedef {ReturnType<typeof import("./lib/aiConnectionClient.js").createAiConnectionClient>} AiConnectionClient */

/**
 * The storage an application gives the conversation runtime. Each operation runs in one transaction
 * of the conversation scope; createConversationStorage, createFileConversationStorage and
 * createMemoryConversationStorage implement it, and the storage contract checks prove another.
 * @typedef {object} ConversationStorage
 * @property {<T>(scope: string, operation: (transaction: object) => Promise<T>) => Promise<T>} read
 * @property {<T>(scope: string, operation: (transaction: object) => Promise<T>) => Promise<T>} write
 * @property {(scope: string) => Promise<void>} [deleteConversation]
 */

/**
 * Whether the caller of one operation may use one conversation.
 * @typedef {(request: { context: object, conversationId: string, operation: string }) => boolean | Promise<boolean>} ConversationAuthorize
 */

/**
 * The application's own conversation host: it may supply each conversation's native facilities.
 * @typedef {object} ConversationHost
 * @property {(request: { id?: string, context: object, input?: unknown, options?: unknown, operation?: string }) => unknown} [conversation]
 * @property {boolean} [nativeTools] Whether native engines may use their own coding tools.
 * @property {object} [commandWrapper]
 */

/**
 * The application's files offered as message attachments.
 * @typedef {object} ConversationAttachments
 * @property {(request: { attachmentIds: string[], context: object, conversationId: string, signal: AbortSignal }) =>
 *   Promise<{ attachments: object[], content?: object[], localFiles?: object[] }>} resolve
 */

/**
 * The authorized AI connections an API conversation resolves its integrationId through.
 * @typedef {object} ConversationConnections
 * @property {(request: { context: object, integrationId: string }) => Promise<object>} resolve
 */

/**
 * An application's own API model client, instead of its AI connections.
 * @typedef {object} ConversationApiClientFactory
 * @property {(request: { context: object, configuration: object }) =>
 *   Promise<{ enabled: boolean, model: object, defaultModel: string }>} resolveClient
 */

/**
 * The API history an application selects for one request, instead of the whole transcript.
 * @typedef {(request: { context: object }) => unknown | Promise<unknown>} ConversationApiHistory
 */

/**
 * Receives each stage of one message's delivery; its result is never awaited.
 * @typedef {(event: { engine: string, conversationId: string, messageId?: string, stage: string, previousStage: string,
 *   durationMs: number, elapsedMs: number, timings: Record<string, number> }) => unknown} ConversationDeliveryTimingObserver
 */

/**
 * The runtime's numeric limits; each absent one takes its default.
 * @typedef {object} ConversationLimits
 * @property {number} [maxToolCalls]
 * @property {number} [maxInputCharacters]
 * @property {number} [maxFinalReplyCharacters]
 * @property {number} [maxOutputCharacters]
 * @property {number} [maxContinuityCharacters]
 * @property {number} [maxAttachmentBytes]
 * @property {number} [timeoutMs]
 */

export {};
