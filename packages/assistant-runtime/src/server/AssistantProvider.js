import { resolveAppConfig } from "@jskit-ai/kernel/server/support";
import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { createAiClient } from "@jskit-ai/assistant-core/server";
import { assistantActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import { createRepository as createAssistantConfigRepository } from "./repositories/assistantConfigRepository.js";
import { createRepository as createConversationsRepository } from "./repositories/conversationsRepository.js";
import { createRepository as createMessagesRepository } from "./repositories/messagesRepository.js";
import { createService as createAssistantConfigService } from "./services/assistantConfigService.js";
import { createChatService } from "./services/chatService.js";
import { createTranscriptService } from "./services/transcriptService.js";
import { resolveAssistantAiConfig } from "./support/assistantServerConfig.js";
import { createSurfaceAwareToolCatalog } from "./support/createSurfaceAwareToolCatalog.js";
import { resolveWorkspaceServerScopeSupport } from "./support/workspaceScopeSupport.js";

function resolveGlobalAssistantConfig(scope) {
  const appConfig = resolveAppConfig(scope);
  const env = scope.has("jskit.env") ? normalizeObject(scope.make("jskit.env")) : {};

  return Object.freeze({
    appConfig,
    env
  });
}

function createAssistantAiClientFactory(config = {}) {
  const resolveCurrentAppConfig =
    typeof config.resolveAppConfig === "function"
      ? () => normalizeObject(config.resolveAppConfig())
      : () => normalizeObject(config.appConfig);
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
          appConfig: resolveCurrentAppConfig(),
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

    const config = resolveGlobalAssistantConfig(app);
    const resolveCurrentAppConfig = () => resolveAppConfig(app);

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

    app.singleton("assistant.ai.client.factory", () => {
      return createAssistantAiClientFactory({
        resolveAppConfig: resolveCurrentAppConfig,
        env: config.env
      });
    });

    app.singleton("assistant.service.tool-catalog", (scope) => {
      return createSurfaceAwareToolCatalog(scope, {
        resolveAppConfig: resolveCurrentAppConfig
      });
    });

    app.service(
      "assistant.config.service",
      (scope) =>
        createAssistantConfigService({
          assistantConfigRepository: scope.make("assistant.config.repository"),
          consoleService: scope.has("consoleService") ? scope.make("consoleService") : null,
          resolveAppConfig: resolveCurrentAppConfig,
          workspaceScopeSupport: resolveWorkspaceServerScopeSupport(scope)
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
          aiClientFactory: scope.make("assistant.ai.client.factory"),
          transcriptService: scope.make("assistant.transcript.service"),
          serviceToolCatalog: scope.make("assistant.service.tool-catalog"),
          assistantConfigService: scope.make("assistant.config.service"),
          resolveAppConfig: resolveCurrentAppConfig,
          workspaceScopeSupport: resolveWorkspaceServerScopeSupport(scope)
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
