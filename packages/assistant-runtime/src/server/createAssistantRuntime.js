import { isDeepStrictEqual } from "node:util";
import { normalizeObject, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { resolveActor } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { createAiClient, createAiConnectionClient } from "@jskit-ai/assistant-core/server";
import { createConversationRuntime } from "@jskit-ai/assistant-core/server/conversation";
import { createSqlConversationStorage } from "./sqlConversationStorage.js";
import { createService as createAssistantConfigService } from "./services/assistantConfigService.js";
import { createChatService } from "./services/chatService.js";
import { createTranscriptService } from "./services/transcriptService.js";
import { resolveAssistantAiConfig, resolveAssistantServerConfig } from "./support/assistantServerConfig.js";
import { createSurfaceAwareToolCatalog } from "./support/createSurfaceAwareToolCatalog.js";
import { createPersonContextPrompt } from "./support/personContext.js";

/** @typedef {import("./types.js").AssistantAttachments} AssistantAttachments */
/** @typedef {import("./types.js").AssistantAiClientFactory} AssistantAiClientFactory */
/** @typedef {import("./types.js").AssistantPersonContext} AssistantPersonContext */
/** @typedef {import("./types.js").AssistantConfigRepository} AssistantConfigRepository */
/** @typedef {import("./types.js").ConversationsRepository} ConversationsRepository */
/** @typedef {import("./types.js").MessagesRepository} MessagesRepository */
/** @typedef {import("./types.js").TurnRequestsRepository} TurnRequestsRepository */
/** @typedef {import("./types.js").SurfaceAwareToolCatalog} SurfaceAwareToolCatalog */
/** @typedef {import("@jskit-ai/connectors-catalog/server/types").AiConnectionResolver} AiConnectionResolver */

/**
 * The AI client of each assistant surface: the authorized connection its
 * configuration names, or one client per surface built from its configuration.
 * @param {{ appConfig?: Record<string, any>, env?: Record<string, string | undefined>, aiConnections?: AiConnectionResolver | null }} config
 */
function createAssistantAiClientFactory(config = {}) {
  const appConfig = normalizeObject(config.appConfig);
  const env = normalizeObject(config.env);
  const cache = new Map();

  async function resolveClient(targetSurfaceId = "", { context, integrationId } = {}) {
    const normalizedTargetSurfaceId = normalizeText(targetSurfaceId).toLowerCase();
    if (!normalizedTargetSurfaceId) {
      throw new Error("assistant.ai.client.factory.resolveClient requires targetSurfaceId.");
    }

    const surfaceConfig = resolveAssistantServerConfig(appConfig, normalizedTargetSurfaceId);
    if (surfaceConfig.aiIntegrationId) {
      const selected = integrationId || surfaceConfig.aiIntegrationId;
      if (![surfaceConfig.aiIntegrationId, ...surfaceConfig.aiIntegrationIds].includes(selected)) {
        throw new AppError(403, "This AI connection is not available in this assistant.", { code: "assistant.runtime.connection.unavailable" });
      }
      if (!config.aiConnections?.resolve) throw new Error("The assistant requires an authorized AI connection resolver.");
      const connection = await config.aiConnections.resolve({ context, integrationId: selected });
      return createAiConnectionClient(connection, { timeoutMs: surfaceConfig.timeoutMs });
    }
    if (integrationId) throw new AppError(403, "This assistant does not allow selecting an AI connection.", {
      code: "assistant.runtime.connection.selectionNotAllowed"
    });

    if (cache.has(normalizedTargetSurfaceId)) {
      return cache.get(normalizedTargetSurfaceId);
    }

    const assistantAiConfig = resolveAssistantAiConfig(
      {
        appConfig,
        env
      },
      normalizedTargetSurfaceId
    );
    const client = createAiClient(assistantAiConfig.ai);
    cache.set(normalizedTargetSurfaceId, client);
    return client;
  }

  return Object.freeze({
    resolveClient
  });
}

/**
 * The assistant over the package's own SQL tables: its repositories, the chat,
 * settings and transcript services, the AI client factory and the tool catalogue.
 * @param {object} dependencies
 * @param {import("@jskit-ai/kernel/server/types").ActionCatalogue} dependencies.actionCatalogue
 * @param {import("@jskit-ai/kernel/server/types").RuntimeConfig} dependencies.config
 * @param {import("@jskit-ai/console-core/server/types").ConsoleCore | null} dependencies.consoleRuntime
 * @param {{ config: AssistantConfigRepository, conversations: ConversationsRepository, messages: MessagesRepository, turnRequests: TurnRequestsRepository }} dependencies.repositories
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {AiConnectionResolver | null} dependencies.aiConnections
 * @param {AssistantAttachments | null} dependencies.attachments
 * @param {AssistantPersonContext} dependencies.personContext
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 * @param {import("@jskit-ai/workspaces-core/server/types").WorkspacesCore | null} dependencies.workspaces
 */
function createAssistantRuntime({
  actionCatalogue,
  config,
  consoleRuntime,
  repositories,
  env,
  aiConnections,
  attachments,
  personContext,
  logger,
  workspaces
}) {
  const {
    config: assistantConfigRepository,
    conversations: conversationsRepository,
    messages: messagesRepository,
    turnRequests
  } = repositories;
  const workspaceScopeSupport = workspaces?.scope || null;
  const aiClientFactory = createAssistantAiClientFactory({ appConfig: config, env, aiConnections });
  const toolCatalog = createSurfaceAwareToolCatalog(actionCatalogue, { appConfig: config });
  const configService = createAssistantConfigService({
    assistantConfigRepository,
    consoleService: consoleRuntime?.services?.access || null,
    appConfig: config,
    workspaceScopeSupport
  });
  const transcriptService = createTranscriptService({ conversationsRepository, messagesRepository });
  const conversationRuntime = createAssistantConversationRuntime({
    conversationsRepository, messagesRepository, aiClientFactory, toolCatalog, attachments
  });
  const chatService = createChatService({
    conversationRuntime,
    turnRequests,
    attachments,
    aiClientFactory,
    transcriptService,
    serviceToolCatalog: toolCatalog,
    assistantConfigService: configService,
    personContextPrompt: createPersonContextPrompt({ personContext, logger }),
    appConfig: config,
    workspaceScopeSupport,
    logger
  });

  return Object.freeze({
    repositories: Object.freeze({
      config: assistantConfigRepository,
      conversations: conversationsRepository,
      messages: messagesRepository,
      turnRequests
    }),
    services: Object.freeze({ chat: chatService, config: configService, transcript: transcriptService }),
    aiClientFactory,
    toolCatalog
  });
}

/**
 * Internal SQL composition: the facade supplies the authenticated action
 * context; the model's history is the conversation's saved history, never the browser's.
 * @param {object} dependencies
 * @param {ConversationsRepository} dependencies.conversationsRepository
 * @param {MessagesRepository} dependencies.messagesRepository
 * @param {AssistantAiClientFactory} dependencies.aiClientFactory
 * @param {SurfaceAwareToolCatalog} dependencies.toolCatalog
 * @param {AssistantAttachments | null} [dependencies.attachments]
 */
function createAssistantConversationRuntime({ conversationsRepository, messagesRepository, aiClientFactory, toolCatalog, attachments }) {
  return createConversationRuntime({
    storage: createSqlConversationStorage({ conversationsRepository, messagesRepository }),
    async authorize({ context, conversationId }) {
      const request = context?.assistantRequest;
      if (!request || request.conversation.id !== conversationId) return false;
      return Boolean(await conversationsRepository.findByIdForActorScope(conversationId, {
        actorUserId: normalizeRecordId(resolveActor(context)?.id, { fallback: null }), surfaceId: context.surface,
        // readable-check: allow no-dual-shape - data: the workspace scope resolves the workspace from the action input or context, which may carry the record or its id
        workspaceId: normalizeRecordId(request.workspace?.id || request.workspace, { fallback: null })
      }));
    },
    apiClientFactory: { resolveClient: ({ context, configuration }) => aiClientFactory.resolveClient(context.surface,
      { context, integrationId: configuration.integrationId }) },
    toolCatalog,
    ...(attachments ? { attachments: {
      // The facade authorized the new message's files before admission; files saved
      // with earlier turns of this conversation are authorized again as they are read.
      resolve({ attachmentIds, context }) {
        const { assistantRequest: request, ...assistantContext } = context;
        const prepared = request.resolvedAttachments[0];
        if (prepared && isDeepStrictEqual(prepared.attachmentIds, attachmentIds)) return request.resolvedAttachments.shift().files;
        return attachments.resolve({ attachmentIds, context: assistantContext, workspace: request.workspace, conversation: request.conversation });
      }
    } } : {})
  });
}

export { createAssistantAiClientFactory, createAssistantRuntime, createAssistantConversationRuntime };
