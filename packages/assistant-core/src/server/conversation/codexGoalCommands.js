import { CODEX_APP_SERVER_AGENT_RUN_ID } from "./codexTurnState.js";

// Private composition of unchanged operations from the original run owner.
export function createCodexGoalCommands({
  conversationContext,
  ensureThreadReady,
  publish,
  readCodexAppServerAgentRunForSession,
  reconcileCodexAppServerGoalUpdated,
  submitCodexAppServerAssistantResult,
  subscribeCodexAppServerEvents,
  turnState
}) {
  async function prepareCodexAppServerGoalContext(sessionId, options, preparation, { prepareThread = false } = {}) {
    let context;
    if (prepareThread) {
      const prepared = await preparation.readiness(ensureThreadReady);
      if (prepared.ok === false) return prepared;
      context = await conversationContext(sessionId, {}, {});
    } else {
      // This is the current command's authorized context. Goal controls
      // may deliberately retain a pinned selection after a model switch.
      context = await conversationContext(sessionId, {}, options === undefined ? {} : options);
    }
    return preparation.project(context, options);
  }

  function validateCodexAppServerGoalInput(input = {}) {
    if (!["set", "pause", "resume", "cancel"].includes(input.action)) {
      return { ok: false, error: "Choose set, pause, resume, or cancel." };
    }
    if (input.action === "set" && (typeof input.objective !== "string" || !input.objective.trim() ||
        (input.tokenBudget !== undefined && (!Number.isSafeInteger(input.tokenBudget) || input.tokenBudget <= 0)))) {
      return { ok: false, error: "Enter a goal objective and an optional positive whole-number token budget." };
    }
    return null;
  }

  async function updateCodexAppServerGoal(sessionId, input = {}, {
    context: initialContext,
    prepareConversation
  } = {}) {
    let context = initialContext;
    if (context.ok === false) return context;
    let threadId = context.threadId;
    if (threadId !== input.threadId || (!threadId && input.action !== "set")) {
      return { ok: false, error: "The Codex conversation changed. Refresh the goal before trying again." };
    }
    if (input.action === "set") {
      if (turnState(context.session).status === "observation_lost") {
        return { ok: false, error: "Resume or send a message to restore the stopped conversation before setting a goal." };
      }
      if (!threadId) {
        context = await prepareConversation();
        if (context.ok === false) return context;
        threadId = context.threadId;
      }
      const { goal: previousGoal } = await context.provider.readGoal(threadId);
      if (previousGoal && (previousGoal.status !== "complete" || previousGoal.createdAt !== input.createdAt)) {
        return { ok: false, error: "The Codex goal changed. Refresh it before setting a new goal." };
      }
      subscribeCodexAppServerEvents(sessionId, context.provider, threadId, context);
      const result = await context.provider.setGoal(threadId, {
        objective: input.objective, tokenBudget: input.tokenBudget
      });
      await reconcileCodexAppServerGoalUpdated(sessionId, context.provider, threadId, {
        params: { goal: result.goal }
      });
      await publish(sessionId, { reason: "codex-goal", nativeGoal: { threadId, goal: result.goal || null } });
      return { ok: true, status: "available", threadId, goal: result.goal || null };
    }
    const { goal } = await context.provider.readGoal(threadId);
    if (!goal || goal.status === "complete" || goal.createdAt !== input.createdAt || goal.objective !== input.objective) {
      return { ok: false, error: "The Codex goal changed. Refresh it before trying again." };
    }
    if (input.action === "cancel") {
      subscribeCodexAppServerEvents(sessionId, context.provider, threadId, context);
      await context.provider.clearGoal(threadId);
      await reconcileCodexAppServerGoalUpdated(sessionId, context.provider, threadId, {
        method: "thread/goal/cleared",
        params: { threadId }
      });
      await publish(sessionId, { reason: "codex-goal", nativeGoal: { threadId, goal: null } });
      return { ok: true, status: "available", threadId, goal: null };
    }
    if (input.action === "pause" && !["active", "paused"].includes(goal.status)) {
      return { ok: false, error: "This goal is already stopped. Refresh its details." };
    }
    const observationLost = turnState(context.session).status === "observation_lost";
    if (observationLost && turnState(context.session).active) {
      return { ok: false, error: "Codex has not yet confirmed a stop. Retry after the service has stopped." };
    }
    if (input.action === "resume" && !["paused", "blocked", "usageLimited", ...(observationLost ? ["active"] : [])].includes(goal.status)) {
      return { ok: false, error: "This goal cannot be resumed from its current status. Refresh its details." };
    }
    subscribeCodexAppServerEvents(sessionId, context.provider, threadId, context);
    if (observationLost && input.action === "resume") {
      const recovered = await submitCodexAppServerAssistantResult(sessionId, threadId, turnState(context.session).turnId, { recoverFromProvider: true });
      if (recovered.reason === "error") throw new Error(recovered.error);
      await context.runtime.store.mutateSession(sessionId, async () => {
        const run = await readCodexAppServerAgentRunForSession(context.runtime.store, sessionId);
        if (run.active || run.providerThreadId !== threadId) throw new Error("The assistant changed. Refresh before resuming.");
        await context.runtime.store.writeAgentRunEvent(sessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
          event: { kind: "codex-observation-explicit-resume" },
          patch: { providerStatus: "interrupted", error: "" }
        });
      });
      await context.provider.resumeThread(threadId, context.resumeOptions);
    }
    const result = await context.provider.setGoalStatus(threadId, input.action === "pause" ? "paused" : "active");
    await reconcileCodexAppServerGoalUpdated(sessionId, context.provider, threadId, {
      params: { goal: result.goal }
    });
    await publish(sessionId, { reason: "codex-goal", nativeGoal: { threadId, goal: result.goal || null } });
    return { ok: true, status: "available", goal: result.goal || null };
  }


  return {
    prepareCodexAppServerGoalContext,
    validateCodexAppServerGoalInput,
    updateCodexAppServerGoal
  };
}
