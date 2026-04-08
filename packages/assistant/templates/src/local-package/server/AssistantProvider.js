import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  DEFAULT_AI_TIMEOUT_MS,
  createAiClient,
  createServiceToolCatalog,
  normalizeOptionalHttpUrl,
  normalizeTimeoutMs
} from "@jskit-ai/assistant-core/server";
import { assistantRuntimeConfig } from "../shared/assistantRuntimeConfig.js";
import { assistantActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import { createRepository as createAssistantConfigRepository } from "./repositories/assistantConfigRepository.js";
import { createRepository as createConversationsRepository } from "./repositories/conversationsRepository.js";
import { createRepository as createMessagesRepository } from "./repositories/messagesRepository.js";
import { createService as createAssistantConfigService } from "./services/assistantConfigService.js";
import { createChatService } from "./services/chatService.js";
import { createTranscriptService } from "./services/transcriptService.js";

function normalizeStringArray(value) {
  const source = Array.isArray(value) ? value : [value];
  return source.map((entry) => normalizeText(entry)).filter(Boolean);
}

function resolveAssistantConfig(scope) {
  const appConfig = scope.has("appConfig") ? normalizeObject(scope.make("appConfig")) : {};
  const env = scope.has("jskit.env") ? normalizeObject(scope.make("jskit.env")) : {};
  const assistantConfig = normalizeObject(appConfig.assistant);

  const provider = normalizeText(env.AI_PROVIDER || assistantConfig.provider).toLowerCase() || "openai";
  const apiKey = normalizeText(env.AI_API_KEY || assistantConfig.apiKey);
  const baseUrl = normalizeOptionalHttpUrl(env.AI_BASE_URL || assistantConfig.baseUrl, {
    context: "assistant AI_BASE_URL"
  });
  const model = normalizeText(assistantConfig.model);
  const timeoutMs = normalizeTimeoutMs(
    env.AI_TIMEOUT_MS || assistantConfig.timeoutMs,
    DEFAULT_AI_TIMEOUT_MS
  );

  return Object.freeze({
    ai: Object.freeze({
      enabled: Boolean(apiKey),
      provider,
      apiKey,
      baseUrl,
      model,
      timeoutMs
    }),
    barredActionIds: normalizeStringArray(assistantConfig.barredActionIds),
    toolSkipActionPrefixes: normalizeStringArray(assistantConfig.toolSkipActionPrefixes)
  });
}

class AssistantProvider {
  static id = "assistant.chat.service";

  static dependsOn = ["runtime.actions", "runtime.database", "auth.policy.fastify", "users.core"];

  register(app) {
    if (
      !app ||
      typeof app.singleton !== "function" ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("AssistantProvider requires application singleton()/service()/actions().");
    }

    const config = resolveAssistantConfig(app);

    app.singleton("assistant.config.repository", (scope) => {
      const knex = scope.make("jskit.database.knex");
      return createAssistantConfigRepository(knex);
    });

    app.singleton("assistant.conversation.repository", (scope) => {
      const knex = scope.make("jskit.database.knex");
      return createConversationsRepository(knex);
    });

    app.singleton("assistant.message.repository", (scope) => {
      const knex = scope.make("jskit.database.knex");
      return createMessagesRepository(knex);
    });

    app.singleton("assistant.ai.client", () => {
      return createAiClient(config.ai);
    });

    app.singleton("assistant.service.tool-catalog", (scope) => {
      return createServiceToolCatalog(scope, {
        barredActionIds: config.barredActionIds,
        skipActionPrefixes: ["assistant.", ...config.toolSkipActionPrefixes]
      });
    });

    app.service(
      "assistant.config.service",
      (scope) =>
        createAssistantConfigService({
          assistantConfigRepository: scope.make("assistant.config.repository"),
          consoleService: scope.has("consoleService") ? scope.make("consoleService") : null
        })
    );

    app.service(
      "assistant.transcript.service",
      (scope) =>
        createTranscriptService({
          conversationsRepository: scope.make("assistant.conversation.repository"),
          messagesRepository: scope.make("assistant.message.repository")
        })
    );

    app.service(
      "assistant.chat.service",
      (scope) =>
        createChatService({
          aiClient: scope.make("assistant.ai.client"),
          transcriptService: scope.make("assistant.transcript.service"),
          serviceToolCatalog: scope.make("assistant.service.tool-catalog"),
          assistantConfigService: scope.make("assistant.config.service")
        })
    );

    app.actions(
      withActionDefaults(assistantActions, {
        domain: "assistant",
        dependencies: {
          chatService: "assistant.chat.service",
          assistantConfigService: "assistant.config.service"
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app);
  }
}

export { AssistantProvider };
