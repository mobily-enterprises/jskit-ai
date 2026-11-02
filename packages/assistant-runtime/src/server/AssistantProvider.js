import { defineFeature } from "@jskit-ai/kernel/server/features";
import { actionIds } from "./actionIds.js";
import { createAssistantActions } from "./actions.js";
import { createHostedAssistant } from "./hostedAssistant.js";
import { registerRoutes } from "./registerRoutes.js";
import { registerConversationSubscriptions } from "./registerConversationSubscriptions.js";

/** @typedef {import("./types.js").AssistantRuntime} AssistantRuntime */
/** @typedef {import("./types.js").ConversationAccess} ConversationAccess */
/** @typedef {import("./types.js").ConversationRuntime} ConversationRuntime */
/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */

/** Before boot registers the conversation subscriptions, there are none to release. */
function releaseNoSubscriptions() {}

/** @type {WeakMap<AssistantRuntime, { actions: ActionCatalogue, release: () => void }>} */
const subscriptionLifecycle = new WeakMap();

/**
 * Refuses a host's conversation access that cannot own the conversation routes,
 * actions and subscriptions.
 * @param {ConversationAccess} conversationAccess
 * @param {ConversationRuntime | null} conversationRuntime
 */
function assertConversationAccess(conversationAccess, conversationRuntime) {
  // readable-check: allow method-probe - input validation: the host supplies its conversation access owner
  if (!conversationRuntime || typeof conversationAccess.router?.register !== "function" ||
      // readable-check: allow method-probe - input validation: the host supplies its conversation access owner
      typeof conversationAccess.wrapAction !== "function") {
    throw new TypeError("assistant.conversation.access requires assistant.conversations, router.register() and wrapAction().");
  }
  if (!["authenticated", "host"].includes(conversationAccess.requestPolicy) ||
      typeof conversationAccess.subscribeActionId !== "string" || !conversationAccess.subscribeActionId.trim() ||
      (conversationAccess.requestPolicy === "host" && conversationAccess.subscribeActionId === actionIds.conversationSubscribe)) {
    throw new TypeError("assistant.conversation.access requires a fixed subscribeActionId and authenticated or host requestPolicy.");
  }
}

const AssistantFeature = defineFeature({
  id: "assistant.runtime",
  domain: "assistant",
  requires: {
    config: "runtime.config",
    env: "runtime.env",
    http: "runtime.http"
  },
  optional: {
    logger: "runtime.logger",
    conversationRuntime: "assistant.conversations",
    conversationAccess: "assistant.conversation.access",
    assistantConfigService: "assistant.settings",
    database: "runtime.database",
    realtime: "runtime.realtime",
    events: "runtime.events",
    aiConnections: "integrations.ai",
    attachments: "assistant.attachments",
    consoleRuntime: "console.core",
    workspaces: "workspaces.core"
  },
  provides: {
    assistant: "assistant.runtime"
  },
  async setup(dependencies, { actionCatalogue }) {
    const { conversationRuntime, conversationAccess, assistantConfigService } = dependencies;
    if (conversationAccess != null) {
      assertConversationAccess(conversationAccess, conversationRuntime);
    }
    let assistant;
    if (conversationRuntime) {
      // readable-check: allow method-probe - input validation: the host supplies its conversation runtime
      if (typeof conversationRuntime.open !== "function") {
        throw new TypeError("assistant.conversations requires createConversationRuntime().");
      }
      assistant = createHostedAssistant({ conversationRuntime, assistantConfigService: assistantConfigService || null });
    } else {
      if (!dependencies.database?.knex) {
        throw new Error("AssistantFeature requires assistant.conversations, or runtime.database for database integration.");
      }
      const { createAssistantRuntime } = await import("./createAssistantRuntime.js");
      const { createRepository: createAssistantConfigRepository } = await import("./repositories/assistantConfigRepository.js");
      const { createRepository: createConversationsRepository } = await import("./repositories/conversationsRepository.js");
      const { createRepository: createMessagesRepository } = await import("./repositories/messagesRepository.js");
      const { createRepository: createTurnRequestsRepository } = await import("./repositories/turnRequestsRepository.js");
      assistant = createAssistantRuntime({
        actionCatalogue,
        config: dependencies.config,
        consoleRuntime: dependencies.consoleRuntime || null,
        env: dependencies.env,
        aiConnections: dependencies.aiConnections || null,
        attachments: dependencies.attachments || null,
        workspaces: dependencies.workspaces || null,
        repositories: {
          config: createAssistantConfigRepository(dependencies.database.knex),
          conversations: createConversationsRepository(dependencies.database.knex),
          messages: createMessagesRepository(dependencies.database.knex),
          turnRequests: createTurnRequestsRepository(dependencies.database.knex)
        }
      });
    }
    registerRoutes(dependencies.http.router, {
      config: dependencies.config,
      conversationRuntime,
      conversationAccess,
      conversationDataSchema: conversationRuntime?.conversationDataSchema ?? null,
      conversationConfigurationSchema: conversationRuntime?.conversationConfigurationSchema ?? null,
      conversationSelectionSchema: conversationRuntime?.conversationSelectionSchema ?? null,
      conversationReplacementSchema: conversationRuntime?.conversationReplacementSchema ?? null,
      assistantConfigService,
      workspaceScopeSupport: dependencies.workspaces?.scope || null
    });
    subscriptionLifecycle.set(assistant, { actions: actionCatalogue, release: releaseNoSubscriptions });
    return { assistant };
  },
  actions({ assistant, conversationAccess, config, workspaces }) {
    return createAssistantActions({
      assistantConfigService: assistant.services.config,
      chatService: assistant.services.chat,
      conversationRuntime: assistant.conversationRuntime,
      conversationAccess,
      conversationDataSchema: assistant.conversationRuntime?.conversationDataSchema ?? null,
      conversationConfigurationSchema: assistant.conversationRuntime?.conversationConfigurationSchema ?? null,
      conversationSelectionSchema: assistant.conversationRuntime?.conversationSelectionSchema ?? null,
      conversationReplacementSchema: assistant.conversationRuntime?.conversationReplacementSchema ?? null,
      workspaceScopeSupport: workspaces?.scope || null,
      config
    });
  },
  boot({ conversationRuntime, conversationAccess, realtime, events, config, env, workspaces, logger }, { outputs }) {
    if (!conversationRuntime || !realtime) return;
    const state = subscriptionLifecycle.get(outputs.assistant);
    state.release = registerConversationSubscriptions({
      realtime, events, actions: state.actions, config, logger, workspaceScopeSupport: workspaces?.scope || null,
      diagnostics: ["1", "true", "yes", "on"].includes(String(env?.JSKIT_REALTIME_DEBUG ?? config?.realtime?.debug ?? "").trim().toLowerCase()),
      ...(conversationAccess ? {
        subscribeActionId: conversationAccess.subscribeActionId,
        requestPolicy: conversationAccess.requestPolicy
      } : {})
    });
  },
  async shutdown(_dependencies, { outputs }) {
    const state = subscriptionLifecycle.get(outputs.assistant);
    subscriptionLifecycle.delete(outputs.assistant);
    state?.release();
    await outputs.assistant.services.chat?.close();
  }
});

export { AssistantFeature };
