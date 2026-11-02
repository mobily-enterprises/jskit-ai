import { AppError } from "@jskit-ai/kernel/server/runtime";
import { requireAssistantSurface } from "./support/assistantSurface.js";

/** @typedef {import("./types.js").ConversationRuntime} ConversationRuntime */
/** @typedef {import("./types.js").WorkspaceScopeSupport} WorkspaceScopeSupport */

/** A subscription caller that does not say whether it is still current stays current. */
function alwaysCurrent() {
  return true;
}

/** A subscription caller that does not follow its stages ignores them. */
function ignoreStage() {}

/**
 * What the conversation actions do: each opens the action's conversation in its
 * context, on the conversation's workspace when its surface requires one, and
 * calls one conversation method.
 * @param {object} dependencies
 * @param {ConversationRuntime} dependencies.conversationRuntime
 * @param {Record<string, any>} dependencies.config
 * @param {WorkspaceScopeSupport | null} dependencies.workspaceScopeSupport
 * @param {object | null} dependencies.conversationDataSchema The application's declared message data, when it declares one.
 */
function createConversationOperations({ conversationRuntime, config, workspaceScopeSupport, conversationDataSchema }) {
  async function openConversation(input, context) {
    const assistantSurface = requireAssistantSurface(config, input.targetSurfaceId);
    let conversationContext = context;
    if (assistantSurface.runtimeSurfaceRequiresWorkspace) {
      if (!workspaceScopeSupport) {
        throw new Error("Assistant conversation actions require workspace server scope support.");
      }
      const workspace = workspaceScopeSupport.resolveWorkspace(context, { workspaceSlug: input.workspaceSlug });
      if (!workspace?.id) throw new AppError(409, "Workspace selection required.", { code: "assistant.runtime.workspace.selectionRequired" });
      conversationContext = { ...context, workspace };
    }
    return conversationRuntime.open({ id: input.conversationId, context: conversationContext });
  }

  async function read(input, context) {
    const conversation = await openConversation(input, context);
    const options = {};
    for (const key of ["beforeTurnId", "limit"]) {
      if (Object.hasOwn(input, key)) options[key] = input[key];
    }
    return Object.keys(options).length ? conversation.read(options) : conversation.read();
  }

  async function send(input, context) {
    const conversation = await openConversation(input, context);
    return conversation.send({
      messageId: input.messageId,
      text: input.text,
      ...(conversationDataSchema && Object.hasOwn(input, "data") ? { data: input.data } : {}),
      ...(Object.hasOwn(input, "attachmentIds") ? { attachmentIds: input.attachmentIds } : {}),
      ...(Object.hasOwn(input, "steer") ? { steer: input.steer } : {})
    });
  }

  async function cancel(input, context) {
    const conversation = await openConversation(input, context);
    return conversation.cancel();
  }

  /**
   * Opens the conversation, attaches the caller's observer and answers with its
   * snapshot. The caller's callbacks come with each call.
   * @param {object} input
   * @param {object} context
   * @param {{ onEvent: Function, onRelease: Function, isCurrent?: () => boolean, onStage?: (stage: string) => void }} deps
   */
  async function subscribe(input, context, deps) {
    // readable-check: allow method-probe - input validation: a subscription's caller hands its event and cleanup callbacks with each call
    if (typeof deps?.onEvent !== "function" || typeof deps?.onRelease !== "function") {
      throw new TypeError("Conversation subscriptions require their server-owned event and cleanup callbacks.");
    }
    const { onEvent, onRelease, isCurrent = alwaysCurrent, onStage = ignoreStage } = deps;
    if (isCurrent() === false) return null;
    onStage("conversation-open");
    const conversation = await openConversation(input, context);
    if (isCurrent() === false) return null;
    onStage("observer-attach");
    const release = await conversation.subscribe(onEvent);
    try {
      onRelease(release);
      if (isCurrent() === false) return null;
      onStage("snapshot-read");
      return await conversation.read();
    } catch (error) {
      release();
      throw error;
    }
  }

  async function inspectDelivery(input, context) {
    const conversation = await openConversation(input, context);
    return conversation.inspectDelivery({ messageId: input.messageId });
  }

  async function cancelDelivery(input, context) {
    const conversation = await openConversation(input, context);
    return conversation.cancelDelivery({ messageId: input.messageId });
  }

  async function readGoal(input, context) {
    return (await openConversation(input, context)).readGoal();
  }

  async function updateGoal(input, context) {
    const conversation = await openConversation(input, context);
    const goal = { action: input.action, expectedSegmentId: input.expectedSegmentId };
    for (const key of ["expectedGoalId", "messageId", "objective", "tokenBudget", "attachmentIds"]) {
      if (Object.hasOwn(input, key)) goal[key] = input[key];
    }
    return conversation.updateGoal(goal);
  }

  async function configure(input, context) {
    return (await openConversation(input, context)).configure(input.configuration);
  }

  async function select(input, context) {
    return (await openConversation(input, context)).select(input.selection);
  }

  async function replace(input, context) {
    return (await openConversation(input, context)).replace(input.replacement);
  }

  return Object.freeze({
    read,
    send,
    cancel,
    subscribe,
    inspectDelivery,
    cancelDelivery,
    readGoal,
    updateGoal,
    configure,
    select,
    replace
  });
}

export { createConversationOperations };
