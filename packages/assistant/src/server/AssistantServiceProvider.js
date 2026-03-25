import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { createRepository as createConversationsRepository } from "./repositories/conversationsRepository.js";
import { createRepository as createMessagesRepository } from "./repositories/messagesRepository.js";
import { createRepository as createAssistantSettingsRepository } from "./repositories/assistantSettingsRepository.js";
import { createChatService } from "./services/chatService.js";
import {
  createService as createAssistantSettingsService,
  serviceEvents as assistantSettingsServiceEvents
} from "./services/assistantSettingsService.js";
import {
  createTranscriptService,
  serviceEvents as transcriptServiceEvents
} from "./services/transcriptService.js";
import { createAiClient } from "./lib/aiClient.js";
import { createServiceToolCatalog } from "./lib/serviceToolCatalog.js";
import { normalizeOptionalHttpUrl } from "./lib/providers/common.js";
import { assistantActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";

const DEFAULT_AI_TIMEOUT_MS = 120_000;

function normalizeInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

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
  const timeoutMs = normalizeInteger(
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
    timeoutMs,
    barredActionIds: normalizeStringArray(assistantConfig.barredActionIds),
    toolSkipActionPrefixes: normalizeStringArray(assistantConfig.toolSkipActionPrefixes)
  });
}

class AssistantServiceProvider {
  static id = "assistant.chat.service";

  static dependsOn = ["runtime.actions", "runtime.database", "auth.policy.fastify", "users.core", "runtime.realtime"];

  register(app) {
    if (
      !app ||
      typeof app.singleton !== "function" ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("AssistantServiceProvider requires application singleton()/service()/actions().");
    }

    const config = resolveAssistantConfig(app);

    app.singleton("assistant.conversation.repository", (scope) => {
      const knex = scope.make("jskit.database.knex");
      return createConversationsRepository(knex);
    });

    app.singleton("assistant.message.repository", (scope) => {
      const knex = scope.make("jskit.database.knex");
      return createMessagesRepository(knex);
    });

    app.singleton("assistant.settings.repository", (scope) => {
      const knex = scope.make("jskit.database.knex");
      return createAssistantSettingsRepository(knex);
    });

    app.singleton("assistant.ai.client", () => {
      return createAiClient(config.ai);
    });

    app.singleton("assistant.service.tool-catalog", (scope) => {
      const skipPrefixes = ["assistant.", ...config.toolSkipActionPrefixes];

      return createServiceToolCatalog(scope, {
        barredActionIds: config.barredActionIds,
        skipActionPrefixes: skipPrefixes
      });
    });

    app.service(
      "assistant.transcript.service",
      (scope) =>
        createTranscriptService({
          conversationsRepository: scope.make("assistant.conversation.repository"),
          messagesRepository: scope.make("assistant.message.repository")
        }),
      {
        events: transcriptServiceEvents
      }
    );

    app.service(
      "assistant.settings.service",
      (scope) =>
        createAssistantSettingsService({
          assistantSettingsRepository: scope.make("assistant.settings.repository"),
          consoleService: scope.make("consoleService")
        }),
      {
        events: assistantSettingsServiceEvents
      }
    );

    app.service(
      "assistant.chat.service",
      (scope) =>
        createChatService({
          aiClient: scope.make("assistant.ai.client"),
          transcriptService: scope.make("assistant.transcript.service"),
          serviceToolCatalog: scope.make("assistant.service.tool-catalog"),
          assistantSettingsService: scope.make("assistant.settings.service")
        }),
      {
        events: {}
      }
    );

    app.actions(
      withActionDefaults(assistantActions, {
        domain: "assistant",
        dependencies: {
          chatService: "assistant.chat.service",
          assistantSettingsService: "assistant.settings.service"
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app);
  }
}

export { AssistantServiceProvider };
