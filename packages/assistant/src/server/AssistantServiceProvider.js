import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { createRepository as createConversationsRepository } from "./repositories/conversationsRepository.js";
import { createRepository as createMessagesRepository } from "./repositories/messagesRepository.js";
import { createChatService } from "./services/chatService.js";
import {
  createTranscriptService,
  serviceEvents as transcriptServiceEvents
} from "./services/transcriptService.js";
import { createAiClient } from "./lib/aiClient.js";
import { createServiceToolCatalog } from "./lib/serviceToolCatalog.js";
import { normalizeOptionalHttpUrl } from "./lib/providers/common.js";
import { assistantActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import {
  ASSISTANT_CONVERSATIONS_REPOSITORY_TOKEN,
  ASSISTANT_MESSAGES_REPOSITORY_TOKEN,
  ASSISTANT_TRANSCRIPT_SERVICE_TOKEN,
  ASSISTANT_CHAT_SERVICE_TOKEN,
  ASSISTANT_AI_CLIENT_TOKEN,
  ASSISTANT_SERVICE_TOOL_CATALOG_TOKEN
} from "./diTokens.js";

const ASSISTANT_PROVIDER_ID = ASSISTANT_CHAT_SERVICE_TOKEN;
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
  const env = scope.has(KERNEL_TOKENS.Env) ? normalizeObject(scope.make(KERNEL_TOKENS.Env)) : {};
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
    barredServiceMethods: normalizeStringArray(assistantConfig.barredServiceMethods),
    toolSkipServicePrefixes: normalizeStringArray(assistantConfig.toolSkipServicePrefixes)
  });
}

class AssistantServiceProvider {
  static id = ASSISTANT_PROVIDER_ID;

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

    app.singleton(ASSISTANT_CONVERSATIONS_REPOSITORY_TOKEN, (scope) => {
      const knex = scope.make(KERNEL_TOKENS.Knex);
      return createConversationsRepository(knex);
    });

    app.singleton(ASSISTANT_MESSAGES_REPOSITORY_TOKEN, (scope) => {
      const knex = scope.make(KERNEL_TOKENS.Knex);
      return createMessagesRepository(knex);
    });

    app.singleton(ASSISTANT_AI_CLIENT_TOKEN, () => {
      return createAiClient(config.ai);
    });

    app.singleton(ASSISTANT_SERVICE_TOOL_CATALOG_TOKEN, (scope) => {
      const skipPrefixes = ["assistant.", ...config.toolSkipServicePrefixes];

      return createServiceToolCatalog(scope, {
        barredServiceMethods: config.barredServiceMethods,
        skipServicePrefixes: skipPrefixes
      });
    });

    app.service(
      ASSISTANT_TRANSCRIPT_SERVICE_TOKEN,
      (scope) =>
        createTranscriptService({
          conversationsRepository: scope.make(ASSISTANT_CONVERSATIONS_REPOSITORY_TOKEN),
          messagesRepository: scope.make(ASSISTANT_MESSAGES_REPOSITORY_TOKEN)
        }),
      {
        events: transcriptServiceEvents
      }
    );

    app.service(
      ASSISTANT_CHAT_SERVICE_TOKEN,
      (scope) =>
        createChatService({
          aiClient: scope.make(ASSISTANT_AI_CLIENT_TOKEN),
          transcriptService: scope.make(ASSISTANT_TRANSCRIPT_SERVICE_TOKEN),
          serviceToolCatalog: scope.make(ASSISTANT_SERVICE_TOOL_CATALOG_TOKEN)
        }),
      {
        events: {}
      }
    );

    app.actions(
      withActionDefaults(assistantActions, {
        domain: "assistant",
        dependencies: {
          chatService: ASSISTANT_CHAT_SERVICE_TOKEN
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app);
  }
}

export { AssistantServiceProvider };
