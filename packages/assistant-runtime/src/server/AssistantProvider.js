import { defineFeature } from "@jskit-ai/kernel/server/features";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { createAiClient } from "@jskit-ai/assistant-core/server";
import { createAssistantActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import { createRepository as createAssistantConfigRepository } from "./repositories/assistantConfigRepository.js";
import { createRepository as createConversationsRepository } from "./repositories/conversationsRepository.js";
import { createRepository as createMessagesRepository } from "./repositories/messagesRepository.js";
import { createService as createAssistantConfigService } from "./services/assistantConfigService.js";
import { createChatService } from "./services/chatService.js";
import { createTranscriptService } from "./services/transcriptService.js";
import { resolveAssistantAiConfig } from "./support/assistantServerConfig.js";
import { createSurfaceAwareToolCatalog } from "./support/createSurfaceAwareToolCatalog.js";

function createAssistantAiClientFactory(config = {}) {
  const appConfig = normalizeObject(config.appConfig);
  const env = normalizeObject(config.env);
  const cache = new Map();

  return Object.freeze({
    resolveClient(targetSurfaceId = "") {
      const normalizedTargetSurfaceId = normalizeText(targetSurfaceId).toLowerCase();
      if (!normalizedTargetSurfaceId) {
        throw new Error("assistant.ai.client.factory.resolveClient requires targetSurfaceId.");
      }

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
  database,
  env,
  workspaces
} = {}) {
  const assistantConfigRepository = createAssistantConfigRepository(database.knex);
  const conversationsRepository = createConversationsRepository(database.knex);
  const messagesRepository = createMessagesRepository(database.knex);
  const workspaceScopeSupport = workspaces?.scope || null;
  const aiClientFactory = createAssistantAiClientFactory({ appConfig: config, env });
  const toolCatalog = createSurfaceAwareToolCatalog(actionCatalogue, { appConfig: config });
  const configService = createAssistantConfigService({
    assistantConfigRepository,
    consoleService: consoleRuntime?.services?.access || null,
    appConfig: config,
    workspaceScopeSupport
  });
  const transcriptService = createTranscriptService({ conversationsRepository, messagesRepository });
  const chatService = createChatService({
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
      messages: messagesRepository
    }),
    services: Object.freeze({ chat: chatService, config: configService, transcript: transcriptService }),
    aiClientFactory,
    toolCatalog
  });
}

const AssistantFeature = defineFeature({
  id: "assistant.runtime",
  domain: "assistant",
  requires: {
    config: "runtime.config",
    database: "runtime.database",
    env: "runtime.env",
    http: "runtime.http"
  },
  optional: {
    consoleRuntime: "console.core",
    workspaces: "workspaces.core"
  },
  provides: {
    assistant: "assistant.runtime"
  },
  setup(dependencies, { actionCatalogue }) {
    const assistant = createAssistantRuntime({ ...dependencies, actionCatalogue });
    registerRoutes(dependencies.http.router, {
      config: dependencies.config,
      workspaceScopeSupport: dependencies.workspaces?.scope || null
    });
    return { assistant };
  },
  actions({ assistant, config }) {
    return createAssistantActions({
      assistantConfigService: assistant.services.config,
      chatService: assistant.services.chat,
      config
    });
  }
});

export { AssistantFeature, createAssistantAiClientFactory, createAssistantRuntime };
