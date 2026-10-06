import { isDeepStrictEqual } from "node:util";
import { normalizeObject, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { createAiClient, createAiConnectionClient } from "@jskit-ai/assistant-core/server";
import { createConversationRuntime } from "@jskit-ai/assistant-core/server/conversation";
import { createSqlConversationStorage } from "./sqlConversationStorage.js";
import { createService as createAssistantConfigService } from "./services/assistantConfigService.js";
import { createChatService } from "./services/chatService.js";
import { createTranscriptService } from "./services/transcriptService.js";
import { resolveAssistantAiConfig, resolveAssistantServerConfig } from "./support/assistantServerConfig.js";
import { createSurfaceAwareToolCatalog } from "./support/createSurfaceAwareToolCatalog.js";

function createAssistantAiClientFactory(config = {}) {
  const appConfig = normalizeObject(config.appConfig);
  const env = normalizeObject(config.env);
  const cache = new Map();

  return Object.freeze({
    async resolveClient(targetSurfaceId = "", { context, integrationId } = {}) {
      const normalizedTargetSurfaceId = normalizeText(targetSurfaceId).toLowerCase();
      if (!normalizedTargetSurfaceId) {
        throw new Error("assistant.ai.client.factory.resolveClient requires targetSurfaceId.");
      }

      const surfaceConfig = resolveAssistantServerConfig(appConfig, normalizedTargetSurfaceId);
      if (surfaceConfig.aiIntegrationId) {
        const selected = integrationId || surfaceConfig.aiIntegrationId;
        if (![surfaceConfig.aiIntegrationId, ...surfaceConfig.aiIntegrationIds].includes(selected)) {
          throw new AppError(403, "This AI connection is not available in this assistant.");
        }
        if (!config.aiConnections?.resolve) throw new Error("The assistant requires an authorized AI connection resolver.");
        const connection = await config.aiConnections.resolve({ context, integrationId: selected });
        return createAiConnectionClient(connection, { timeoutMs: surfaceConfig.timeoutMs });
      }
      if (integrationId) throw new AppError(403, "This assistant does not allow selecting an AI connection.");

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
  });
}

function createAssistantRuntime({
  actionCatalogue,
  config,
  consoleRuntime,
  repositories = {},
  env,
  aiConnections,
  attachments,
  workspaces
} = {}) {
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
    appConfig: config,
    workspaceScopeSupport
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

// Internal SQL composition: the existing facade supplies the authenticated action
// context and normalized request history, never another browser context channel.
function createAssistantConversationRuntime({ conversationsRepository, messagesRepository, aiClientFactory, toolCatalog, attachments }) {
  return createConversationRuntime({
    storage: createSqlConversationStorage({ conversationsRepository, messagesRepository }),
    async authorize({ context, conversationId }) {
      const request = context?.assistantRequest;
      if (!request || request.conversation.id !== conversationId) return false;
      return Boolean(await conversationsRepository.findByIdForActorScope(conversationId, {
        actorUserId: normalizeRecordId(context.actor?.id, { fallback: null }), surfaceId: context.surface,
        workspaceId: normalizeRecordId(request.workspace?.id || request.workspace, { fallback: null })
      }));
    },
    apiClientFactory: { preserveWhitespace: false, resolveClient: ({ context, configuration }) => aiClientFactory.resolveClient(context.surface,
      { context, integrationId: configuration.integrationId }) },
    apiHistory: ({ context }) => context.assistantRequest.history,
    toolCatalog,
    ...(attachments ? { attachments: {
      resolve({ attachmentIds, context }) {
        const prepared = context.assistantRequest.resolvedAttachments.shift();
        if (!prepared || !isDeepStrictEqual(prepared.attachmentIds, attachmentIds)) {
          throw new Error("The API attachment request differs from its authorized request context.");
        }
        return prepared.files;
      }
    } } : {})
  });
}

export { createAssistantAiClientFactory, createAssistantRuntime, createAssistantConversationRuntime };
