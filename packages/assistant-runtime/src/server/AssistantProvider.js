import { defineFeature } from "@jskit-ai/kernel/server/features";
import { actionIds } from "./actionIds.js";
import { createAssistantActions } from "./actions.js";
import { createHostedAssistant } from "./hostedAssistant.js";
import { registerRoutes } from "./registerRoutes.js";
import { registerConversationSubscriptions } from "./registerConversationSubscriptions.js";
import { NO_PERSON_CONTEXT } from "./support/personContext.js";

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
    events: "runtime.events",
    http: "runtime.http",
    logger: "runtime.logger"
  },
  optional: {
    conversationRuntime: "assistant.conversations",
    conversationAccess: "assistant.conversation.access",
    assistantConfigService: "assistant.settings",
    repositories: "assistant.repositories",
    realtime: "runtime.realtime",
    aiConnections: "integrations.ai",
    attachments: "assistant.attachments",
    personContext: "assistant.personContext",
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
      // A host that supplies its conversations builds their instructions, so it
      // composes assistant.personContext into them itself, with createPersonContextPrompt.
      assistant = createHostedAssistant({ conversationRuntime, assistantConfigService: assistantConfigService || null });
    } else {
      // The database-backed assistant keeps its rows through AssistantStoreFeature's repositories.
      if (!dependencies.repositories) {
        throw new Error(
          "AssistantFeature keeps conversations in assistant.repositories, which no feature provides: register AssistantStoreFeature " +
          "from @jskit-ai/assistant-runtime/server in your server providers, or provide assistant.conversations (createConversationRuntime())."
        );
      }
      const { createAssistantRuntime } = await import("./createAssistantRuntime.js");
      assistant = createAssistantRuntime({
        actionCatalogue,
        config: dependencies.config,
        consoleRuntime: dependencies.consoleRuntime || null,
        env: dependencies.env,
        aiConnections: dependencies.aiConnections || null,
        attachments: dependencies.attachments || null,
        personContext: dependencies.personContext ?? NO_PERSON_CONTEXT,
        logger: dependencies.logger,
        workspaces: dependencies.workspaces || null,
        repositories: dependencies.repositories
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
