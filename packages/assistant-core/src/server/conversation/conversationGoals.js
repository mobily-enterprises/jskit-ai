import { isDeepStrictEqual } from "node:util";
import { conversationAttachmentIds } from "./attachments.js";
import { failure } from "./conversationRefusals.js";
import { pendingSuccessor, submittedMessage } from "./conversationReads.js";
import { serial } from "./conversationEvents.js";

/** @typedef {import("./conversationEntries.js").ConversationEntry} ConversationEntry */

/**
 * Reading and changing an open conversation's native goal.
 * @param {object} dependencies
 * @param {import("./conversationEvents.js").ConversationEvents} dependencies.events
 * @param {import("./conversationEntries.js").ConversationEntries} dependencies.entries
 * @param {import("./conversationReads.js").ConversationReads} dependencies.reads
 * @param {import("./conversationSending.js").ConversationSending} dependencies.sending
 * @param {import("./conversationStopping.js").ConversationStopping} dependencies.stopping
 * @param {import("../types.js").ServiceToolCatalog | null} dependencies.catalog
 */
function createConversationGoals({ events, entries, reads, sending, stopping, catalog }) {
  /**
   * @param {ConversationEntry} entry
   * @param {object} context
   * @param {string} representation
   */
  async function readGoal(entry, context, representation) {
    await events.access(context, entry.id, "readGoal", entry);
    if (!reads.capabilities(entry).goals) return null;
    const configuration = representation === "native" ? undefined : (await entries.readState(entry)).configuration;
    const result = await entry.provider.readGoal({ context, configuration });
    if (entry.conversation && representation !== "native" && result.nativeResult.status === "unavailable") {
      throw failure("The native goal is unavailable. Try reading its status again.", "conversation_goal_unavailable", 503);
    }
    entry.goal = entry.conversation ? result.goal : result;
    return representation === "native" ? result.nativeResult : structuredClone(entry.goal);
  }

  /**
   * @param {ConversationEntry} entry
   * @param {object} context
   * @param {object} input
   * @param {string} representation
   * @param {boolean} [retryFinishedTurn] Whether a goal that Claude's completion refused may be admitted once more.
   */
  async function updateGoal(entry, context, input, representation, retryFinishedTurn = true) {
    await events.access(context, entry.id, "goal", entry);
    context?.signal?.throwIfAborted();
    if (!reads.capabilities(entry).goals) throw failure("This connection does not support native goals.", "conversation_goals_unsupported", 400, { messageCode: "assistant.conversation.goalsUnsupported" });
    if (representation === "native") {
      const { operation } = await serial(entry, async () => {
        await events.access(context, entry.id, "goal", entry);
        // The original goal owner has its own admission. Its native message
        // acknowledgement must not hold the common queue ahead of Stop.
        return { operation: entry.provider.updateGoal({ context, input, representation }) };
      });
      const result = await operation;
      if (result.nativeResult.ok !== false) {
        entry.goal = result.goal;
        await events.emit(entry, { type: "goal", goal: entry.goal });
      }
      return result.nativeResult;
    }
    if (!input || !["set", "resume", "pause", "cancel"].includes(input.action) ||
        (typeof input.expectedSegmentId !== "string" && !(entry.conversation && input.expectedSegmentId === null)) ||
        input.expectedGoalId != null && (typeof input.expectedGoalId !== "string" || !input.expectedGoalId)) {
      throw failure("A goal action and current conversation segment are required.", "conversation_invalid_goal", 400, { messageCode: "assistant.conversation.goalActionRequired" });
    }
    const starting = input.action === "set" || input.action === "resume";
    const goal = { action: input.action, expectedSegmentId: input.expectedSegmentId, expectedGoalId: input.expectedGoalId || null };
    if (starting) {
      if (input.action === "set") {
        if (input.tokenBudget != null && !entry.driver.capabilities.goalBudgets) throw failure("This connection does not support goal token budgets.", "conversation_goal_token_budgets_unsupported", 400, { messageCode: "assistant.conversation.goalTokenBudgetsUnsupported" });
        if (typeof input.objective !== "string" || !input.objective.trim() || input.objective.length > 4000 ||
            input.tokenBudget != null && (!Number.isSafeInteger(input.tokenBudget) || input.tokenBudget < 1)) {
          throw failure("A bounded objective and optional positive token budget are required.", "conversation_invalid_goal", 400, { messageCode: "assistant.conversation.goalObjectiveInvalid" });
        }
        goal.objective = input.objective.trim();
        if (input.tokenBudget != null) goal.tokenBudget = input.tokenBudget;
      } else if (!goal.expectedGoalId) throw failure("Select the goal to resume.", "conversation_invalid_goal", 400, { messageCode: "assistant.conversation.goalToResumeRequired" });
    }
    if (!starting && !input.expectedGoalId) throw failure("Select the goal to stop.", "conversation_invalid_goal", 400, { messageCode: "assistant.conversation.goalToStopRequired" });
    const delivery = entry.driver.capabilities.goalCommands?.[input.action]?.delivery;
    if (!["message", "control"].includes(delivery)) throw failure("This connection does not support that goal command.", "conversation_goal_command_unsupported", 400, { messageCode: "assistant.conversation.goalCommandUnsupported" });
    const messageCommand = delivery === "message";
    if (messageCommand && (typeof input.messageId !== "string" || !/^[\w-]{1,128}$/u.test(input.messageId))) {
      throw failure("A stable messageId is required for this goal command.", "conversation_invalid_message", 400, { messageCode: "assistant.conversation.goalMessageIdRequired" });
    }
    if (conversationAttachmentIds(input.attachmentIds).length || input.attachments?.length) {
      throw failure("This engine's native goal commands do not accept attachments.", "conversation_goal_attachments_unsupported", 400, { messageCode: "assistant.conversation.goalAttachmentsUnsupported" });
    }
    const result = await serial(entry, async () => {
      await events.access(context, entry.id, "goal", entry);
      if (entry.conversation) await entries.readState(entry);
      if (entry.segmentId !== input.expectedSegmentId) throw failure("The conversation changed before this goal command was sent.", "conversation_goal_changed", 409, { messageCode: "assistant.conversation.goalConversationChanged" });
      if (entry.conversation && input.expectedSegmentId === null && input.action !== "set") {
        throw failure("This command requires an existing native conversation.", "conversation_goal_changed", 409, { messageCode: "assistant.conversation.goalNeedsNativeConversation" });
      }
      if (entry.storageFailure) throw entry.storageFailure;
      if (entry.executionFailure) throw entry.executionFailure;
      if (messageCommand) {
        const history = await reads.readTranscript(entry);
        const existing = history.find(turn => submittedMessage(turn)?.messageId === input.messageId);
        if (existing) {
          if (!entry.conversation && !isDeepStrictEqual(submittedMessage(existing).goal, goal)) throw failure("This messageId already belongs to different content.", "conversation_message_id_content_conflict", 409, { messageCode: "assistant.conversation.messageIdContentConflict" });
          return { receipt: { status: "accepted", messageId: input.messageId, turnId: existing.turnId, origin: "user", duplicate: true } };
        }
      }
      if (entry.active && !entry.active.request.accepted) throw failure("Wait for the goal command to be admitted.", "conversation_busy", 409, { messageCode: "assistant.conversation.waitForGoalCommand" });
      const metadata = { runtime: await entries.readState(entry) };
      if (metadata.runtime.request && (entry.engine === "api" || metadata.runtime.request.attempted || metadata.runtime.request.inspectionOnly)) {
        throw failure("Check the uncertain command's delivery before changing the goal.", "conversation_delivery_uncertain", 409, { messageCode: "assistant.conversation.goalCommandDeliveryUncertain" });
      }
      if (entry.driver.canonicalTranscript && metadata.runtime.binding?.goalRequest) {
        throw failure("A goal command from an earlier runtime has unresolved delivery. Inspect its saved state before changing the goal.", "conversation_delivery_uncertain", 409, { messageCode: "assistant.conversation.earlierGoalCommandUnresolved" });
      }
      if (starting && (metadata.runtime.replacement || !entry.conversation && pendingSuccessor(metadata.runtime) || metadata.runtime.lastEngine !== entry.engine)) {
        throw failure("Send a message to catch this AI up before starting or resuming its goal.", "conversation_briefing_before_goal", 409, { messageCode: "assistant.conversation.briefingBeforeGoal" });
      }
      // Definitions keep native thread discovery stable. A control has no
      // admitted request, application-tool actor or executor of its own.
      const tools = catalog && entry.driver.toolDiscovery
        ? { schemas: catalog.resolveToolSet(context, { discoveryOnly: true }).tools.map(catalog.toOpenAiToolSchema) } : undefined;
      if (entry.conversation) {
        let receipt;
        // Preserve the original goal owner's acknowledgement wait outside the
        // invocation queue so the same Stop command can still interrupt it.
        const operation = entry.provider.updateGoal({ context, configuration: metadata.runtime.configuration,
          input: { ...input, ...goal }, representation, tools, interrupt: () => stopping.stop(entry, context),
          async send({ message }, { threadId }) {
            const admission = await serial(entry, async () => {
              const state = await entries.readState(entry);
              const selectedSegment = `${entry.engine}:${threadId}`;
              if (!threadId || state.segmentId !== selectedSegment ||
                  input.expectedSegmentId !== null && input.expectedSegmentId !== selectedSegment) {
                throw failure("The conversation changed before this goal command was sent.", "conversation_goal_changed", 409, { messageCode: "assistant.conversation.goalConversationChanged" });
              }
              return sending.admitSend(entry, context, { messageId: input.messageId, text: message }, "user",
                { ...goal, expectedSegmentId: selectedSegment });
            });
            const accepted = await (admission.receipt || admission.promise);
            if (accepted.error) throw accepted.error;
            receipt = accepted.receipt;
          }
        }).then(async updated => {
          if (updated.nativeResult.ok === false) throw Object.assign(new Error(updated.nativeResult.error), updated.nativeResult);
          entry.goal = updated.goal;
          await events.emit(entry, { type: "goal", goal: entry.goal });
          return receipt ? { receipt } : { goal: structuredClone(entry.goal) };
        });
        return { operation };
      }
      let delivery;
      const updated = await entry.provider.updateGoal({ context, configuration: metadata.runtime.configuration, input: { ...input, ...goal }, tools,
        interrupt: () => stopping.stop(entry, context),
        async send({ message }) {
          delivery = await sending.admitSend(entry, context, { messageId: input.messageId, text: message }, "user", goal);
        }
      });
      // Release the queue once Send is reserved, just as an ordinary message
      // does. Stop remains available while native acknowledgement is pending.
      if (delivery) return delivery;
      entry.goal = updated;
      await events.emit(entry, { type: "goal", goal: entry.goal });
      return { goal: structuredClone(entry.goal) };
    });
    try {
      const completed = result.operation ? await result.operation : result;
      return await (completed.receipt || completed.promise || completed.goal);
    } catch (error) {
      if (!retryFinishedTurn || !entry.conversation || !starting || !messageCommand ||
          error.code !== "conversation_steer_turn_finished" || error.delivery !== "not-sent") throw error;
      // Completion can retire Claude's generation during asynchronous native
      // preparation. Its exact pre-write rejection permits one re-admission of
      // this same goal/message ID, after the original cleanup and save finish.
      await entry.active?.done;
      return updateGoal(entry, context, input, representation, false);
    }
  }

  return Object.freeze({
    readGoal,
    updateGoal
  });
}

/** @typedef {ReturnType<typeof createConversationGoals>} ConversationGoals */

export { createConversationGoals };
