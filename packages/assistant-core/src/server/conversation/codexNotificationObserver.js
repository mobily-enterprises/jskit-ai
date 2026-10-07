import {
  codexAppServerTurnStatusIsActive,
  codexAppServerTurnStatusIsSuccessfulComplete,
  codexAppServerTurnStatusIsProviderFailure,
  normalizeCodexRunText,
  CODEX_APP_SERVER_AGENT_RUN_ID,
  CODEX_AGENT_PROVIDER,
  CODEX_APP_SERVER_RUN_STATE
} from "./codexTurnState.js";
import { codexAppServerProviderConnectionGeneration } from "./codexProvider.js";
import {
  codexAppServerAssistantItemText,
  codexAppServerNotificationEvent,
  codexAppServerNotificationEventType,
  codexAppServerNotificationEventPayload,
  codexAppServerNotificationItem,
  classifyCodexAppServerEvent,
  codexAppServerNotificationParams,
  codexAppServerNotificationThreadId,
  codexAppServerNotificationTurnId,
  codexAppServerNotificationTurnStatus,
  codexAppServerNotificationError,
  codexAppServerContextRefreshReason,
  codexAppServerNotificationUsageLimitExceeded
} from "./codexEvents.js";

// Original native notifications, goal updates and provider-generation subscriptions.
// The existing queue and operation owners retain their state and ordering.
export function createCodexNotificationObserver({
  journal,
  recovery,
  threadStatus,
  output,
  delivery,
  notificationQueue,
  namespace,
  createRuntime,
  createStore,
  publish,
  captureContext,
  debugLog,
  onNotificationSignal,
  turnStateFromAgentRun
}) {
  const { resolveTurnId: resolveCodexAppServerTurnId } = journal;
  const {
    recoverFinalizingTurn: recoverCodexAppServerFinalizingTurn,
    markTurnActive: markCodexAppServerTurnActive,
    markProviderTurnActive: markCodexAppServerProviderTurnActive,
    stopTurnWithProviderFailure: stopCodexAppServerTurnWithProviderFailure,
    completeTurn: completeCodexAppServerTurn
  } = recovery;
  const { reconcileThreadStatus: reconcileCodexAppServerThreadStatus } = threadStatus;
  const {
    readAgentRunForSession: readCodexAppServerAgentRunForSession,
    recordReasoningForSession: recordCodexAppServerReasoningForSession,
    writeStream: writeCodexAppServerStream,
    recordFinalAssistantResult: recordCodexAppServerFinalAssistantResult,
    writeLiveProgress: writeCodexAppServerLiveProgress,
    mirrorTerminalAssistantMessage: mirrorCodexAppServerTerminalAssistantMessage
  } = output;
  const { mirrorTerminalUserMessage: mirrorCodexAppServerTerminalUserMessage } = delivery;
  const codexAppServerNotificationQueue = notificationQueue;
  const { run: runCodexAppServerNotificationTask } = codexAppServerNotificationQueue;
  const CODEX_APP_SERVER_GOAL_STATUSES = new Set([
    "active", "blocked", "budgetLimited", "complete", "paused", "usageLimited"
  ]);
  const codexAppServerEventSubscriptions = new Map();
  const codexAppServerAutomaticHookThreads = new Set();

  function codexAppServerEventSubscriptionKey(providerKey = "", threadId = "") {
    return `${normalizeCodexRunText(providerKey)}:${normalizeCodexRunText(threadId)}`;
  }

  function codexAppServerEventSubscriptionIsCurrent(key = "", provider = null) {
    const record = codexAppServerEventSubscriptions.get(key);
    if (!record) {
      return false;
    }
    const providerGeneration = codexAppServerProviderConnectionGeneration(provider);
    return !providerGeneration || record.connectionGeneration === providerGeneration;
  }

  function unsubscribeCodexAppServerEventSubscription(key = "") {
    const record = codexAppServerEventSubscriptions.get(key);
    record?.unsubscribe?.();
    codexAppServerEventSubscriptions.delete(key);
  }

  function queueCodexAppServerReasoning(context, notification) {
    return codexAppServerNotificationQueue.reasoning(context, notification, recordCodexAppServerReasoningForSession);
  }

  function queueCodexAppServerStream(context, classification) {
    return codexAppServerNotificationQueue.stream(context, classification, writeCodexAppServerStream);
  }

  async function reconcileCodexAppServerGoalUpdated(
    sessionId = "",
    provider = null,
    threadId = "",
    notification = {}
  ) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(threadId);
    const notificationTurnId = codexAppServerNotificationTurnId(notification);
    const goalStatus = normalizeCodexRunText(notification.params?.goal?.status);
    const goalCleared = notification.method === "thread/goal/cleared";
    const runtime = await createRuntime();
    let run = await readCodexAppServerAgentRunForSession(
      runtime.store,
      normalizedSessionId
    );
    if (run?.providerStatus === "observation_lost") return { ok: true, processed: false, reason: "observation_lost" };
    const currentThreadId = normalizeCodexRunText(run?.providerThreadId);
    if (currentThreadId && currentThreadId !== normalizedThreadId) {
      return { ok: true, processed: false, reason: "goal_thread_changed" };
    }
    if (
      (goalCleared || CODEX_APP_SERVER_GOAL_STATUSES.has(goalStatus)) &&
      (
        normalizeCodexRunText(run?.providerGoalStatus) !== goalStatus ||
        normalizeCodexRunText(run?.providerGoalThreadId) !== normalizedThreadId
      )
    ) {
      const updatedAt = new Date().toISOString();
      await runtime.store.writeAgentRunEvent(normalizedSessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
        event: {
          goalStatus,
          kind: "codex-app-server-goal-status-updated",
          message: "",
          providerThreadId: normalizedThreadId
        },
        patch: {
          ...(!run ? {
            provider: CODEX_AGENT_PROVIDER,
            providerInterface: "codex_app_server",
            providerThreadId: normalizedThreadId,
            state: CODEX_APP_SERVER_RUN_STATE.COMPLETED
          } : {}),
          providerGoalStatus: goalStatus,
          providerGoalThreadId: normalizedThreadId,
          providerGoalUpdatedAt: updatedAt
        }
      });
      run = await readCodexAppServerAgentRunForSession(
        runtime.store,
        normalizedSessionId
      );
    }
    const turn = turnStateFromAgentRun(run || {});
    const alreadyFollowingGoalTurn = (
      goalStatus === "active" &&
      turn.active &&
      ["active", "finalizing"].includes(turn.state) &&
      turn.threadId === normalizedThreadId &&
      (!notificationTurnId || turn.turnId === notificationTurnId)
    );
    if (alreadyFollowingGoalTurn) {
      return {
        ok: true,
        processed: false,
        reason: "goal_turn_already_active"
      };
    }
    if (
      (goalCleared || CODEX_APP_SERVER_GOAL_STATUSES.has(goalStatus)) &&
      goalStatus !== "active" &&
      turn.state === "finalizing" &&
      turn.threadId === normalizedThreadId &&
      (!notificationTurnId || turn.turnId === notificationTurnId)
    ) {
      return recoverCodexAppServerFinalizingTurn(
        normalizedSessionId,
        normalizedThreadId,
        turn.turnId,
        {
          status: turn.status || "completed"
        }
      );
    }
    return reconcileCodexAppServerThreadStatus(
      normalizedSessionId,
      provider,
      normalizedThreadId,
      {
        observeLatestTurn: true,
        source: "goal_updated"
      }
    );
  }

  function subscribeCodexAppServerEvents(sessionId = "", provider = null, threadId = "", options = {}) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(threadId);
    if (!normalizedSessionId || !normalizedThreadId || typeof provider?.subscribe !== "function") {
      throw new Error("Codex thread observation requires a session, thread and provider subscription.");
    }
    const projectContext = captureContext();
    const sessionKey = namespace(normalizedSessionId);
    const providerKey = normalizeCodexRunText(options.providerKey);
    const key = codexAppServerEventSubscriptionKey(providerKey, normalizedThreadId);
    const existing = codexAppServerEventSubscriptions.get(key);
    if (existing && codexAppServerEventSubscriptionIsCurrent(key, provider)) {
      return {
        ok: true,
        status: "alreadySubscribed"
      };
    }
    if (existing) {
      unsubscribeCodexAppServerEventSubscription(key);
    }
    // A new observer cannot confirm a previously active phase. Fresh native
    // events restore it; a stored phase alone must not animate activity.
    runCodexAppServerNotificationTask({ projectContext, provider, sessionId: normalizedSessionId, sessionKey }, async () => {
      const store = await createStore(normalizedSessionId);
      const run = await readCodexAppServerAgentRunForSession(store, normalizedSessionId);
      if (!run?.providerPhase || run.providerThreadId !== normalizedThreadId) return;
      await markCodexAppServerTurnActive(normalizedSessionId, {
        phase: "", requireTrackedTurn: true,
        threadId: normalizedThreadId, turnId: run.providerTurnId
      });
    });
    const onNotification = (notification = {}) => {
      const method = normalizeCodexRunText(notification.method);
      if (method === "account/rateLimits/updated" || method === "account/updated") {
        runCodexAppServerNotificationTask({ method, projectContext, provider, sessionId: normalizedSessionId, sessionKey }, () =>
          publish(normalizedSessionId, { reason: "codex-plan-usage" }));
        return;
      }
      const notificationThreadId = codexAppServerNotificationThreadId(notification);
      if (notificationThreadId !== normalizedThreadId) {
        return;
      }
      const notificationContext = {
        method,
        projectContext,
        provider,
        sessionId: normalizedSessionId,
        sessionKey,
        threadId: normalizedThreadId,
        turnId: codexAppServerNotificationTurnId(notification)
      };
      if (method === "thread/tokenUsage/updated") {
        runCodexAppServerNotificationTask(notificationContext, async () => {
          const store = await createStore(normalizedSessionId);
          return onNotificationSignal("usage", {
            store, sessionId: normalizedSessionId, threadId: normalizedThreadId, notification
          });
        });
      }
      const classification = classifyCodexAppServerEvent(notification);
      if (classification.kind === "provider_error" && classification.text &&
          codexAppServerNotificationParams(notification).willRetry !== true) {
        runCodexAppServerNotificationTask(notificationContext, async () => {
          return onNotificationSignal("provider_error", {
            sessionId: normalizedSessionId, threadId: normalizedThreadId, provider,
            turnId: await resolveCodexAppServerTurnId(normalizedSessionId, normalizedThreadId,
              codexAppServerNotificationTurnId(notification)),
            error: classification.text
          });
        });
      }
      if (classification.kind === "hook_prompt") {
        codexAppServerAutomaticHookThreads.add(normalizedThreadId);
        return;
      }
      const contextRefreshReason = codexAppServerContextRefreshReason(notification);
      const itemType = codexAppServerNotificationItem(notification)?.type;
      const retrying = classification.phase === "retrying";
      if (!codexAppServerAutomaticHookThreads.has(normalizedThreadId) &&
          (retrying || method === "item/started" || method === "item/completed" && ["contextCompaction", "reasoning"].includes(itemType))) {
        runCodexAppServerNotificationTask(notificationContext, async () => {
          const phase = retrying ? "retrying" : method === "item/started"
            ? ({ contextCompaction: "compacting", reasoning: "reasoning" })[itemType] || ""
            : "";
          const store = await createStore(normalizedSessionId);
          const run = await readCodexAppServerAgentRunForSession(store, normalizedSessionId);
          if (normalizeCodexRunText(run?.providerPhase) === phase) return;
          return markCodexAppServerTurnActive(normalizedSessionId, {
            phase, requireTrackedTurn: true,
            threadId: normalizedThreadId,
            turnId: codexAppServerNotificationTurnId(notification)
          });
        });
      }
      if (contextRefreshReason) {
        runCodexAppServerNotificationTask(notificationContext, () => {
          return onNotificationSignal("context_refresh", {
            sessionId: normalizedSessionId, threadId: normalizedThreadId,
            notification, reason: contextRefreshReason
          });
        });
      }
      if (method === "thread/goal/cleared") {
        runCodexAppServerNotificationTask(notificationContext, async () => {
          await reconcileCodexAppServerGoalUpdated(normalizedSessionId, provider, normalizedThreadId, notification);
          await publish(normalizedSessionId, { reason: "codex-goal", nativeGoal: { threadId: normalizedThreadId, goal: null } });
        });
        return;
      }
      if (method === "thread/goal/updated") {
        runCodexAppServerNotificationTask(notificationContext, async () => {
          await publish(normalizedSessionId, { reason: "codex-goal", nativeGoal: { threadId: normalizedThreadId, goal: notification.params.goal } });
          return reconcileCodexAppServerGoalUpdated(
            normalizedSessionId,
            provider,
            normalizedThreadId,
            notification
          );
        });
        return;
      }
      if (
        (method.startsWith("item/reasoning/") ||
          method === "item/completed" && codexAppServerNotificationItem(notification)?.type === "reasoning") &&
        !codexAppServerAutomaticHookThreads.has(normalizedThreadId)
      ) {
        queueCodexAppServerReasoning(notificationContext, notification);
      }
      if (["assistant_started", "assistant_delta"].includes(classification.kind) &&
          !codexAppServerAutomaticHookThreads.has(normalizedThreadId)) {
        queueCodexAppServerStream(notificationContext, classification);
      }
      if (classification.kind === "final_assistant_result") {
        const event = codexAppServerNotificationEvent(notification);
        const payload = codexAppServerNotificationEventPayload(notification, event);
        const params = codexAppServerNotificationParams(notification);
        runCodexAppServerNotificationTask(notificationContext, () => {
          return recordCodexAppServerFinalAssistantResult({
            itemId: classification.itemId,
            notification,
            sessionId: normalizedSessionId,
            source: classification.source,
            text: classification.text,
            threadId: normalizedThreadId,
            turnId: normalizeCodexRunText(
              params.turnId ||
              params.turn_id ||
              params.turn?.id
            )
          });
        });
        debugLog("appServerFinalAssistantResult.received", {
          eventId: normalizeCodexRunText(event?.id),
          eventType: codexAppServerNotificationEventType(notification, event),
          itemId: normalizeCodexRunText(codexAppServerNotificationItem(notification)?.id),
          method,
          payloadId: normalizeCodexRunText(payload?.id),
          stableItemId: classification.itemId,
          source: classification.source,
          sessionId: normalizedSessionId,
          threadId: normalizedThreadId,
          turnId: classification.turnId
        });
      }
      if (
        classification.kind === "thinking" ||
        classification.kind === "live_progress"
      ) {
        if (codexAppServerAutomaticHookThreads.has(normalizedThreadId)) {
          return;
        }
        runCodexAppServerNotificationTask(notificationContext, () => {
          return writeCodexAppServerLiveProgress(normalizedSessionId, normalizedThreadId, notification);
        });
      }
      if (method === "item/completed") {
        const item = codexAppServerNotificationItem(notification);
        if (normalizeCodexRunText(item?.type) === "userMessage") {
          runCodexAppServerNotificationTask(notificationContext, () => {
            return mirrorCodexAppServerTerminalUserMessage(normalizedSessionId, normalizedThreadId, notification);
          });
          return;
        }
        if (codexAppServerAssistantItemText(item)) {
          runCodexAppServerNotificationTask(notificationContext, () => {
            return mirrorCodexAppServerTerminalAssistantMessage(normalizedSessionId, normalizedThreadId, notification);
          });
          return;
        }
      }
      if (method === "turn/started") {
        codexAppServerAutomaticHookThreads.delete(normalizedThreadId);
        runCodexAppServerNotificationTask(notificationContext, () => markCodexAppServerProviderTurnActive(normalizedSessionId, {
          source: "turn_started",
          status: codexAppServerNotificationTurnStatus(notification) || "inProgress",
          threadId: normalizedThreadId,
          turnId: codexAppServerNotificationTurnId(notification)
        }));
        return;
      }
      if (method === "turn/completed") {
        codexAppServerAutomaticHookThreads.delete(normalizedThreadId);
        const turnId = codexAppServerNotificationTurnId(notification);
        const status = codexAppServerNotificationTurnStatus(notification) || "completed";
        if (codexAppServerTurnStatusIsProviderFailure(status)) {
          runCodexAppServerNotificationTask(notificationContext, () => {
            return stopCodexAppServerTurnWithProviderFailure(normalizedSessionId, normalizedThreadId, turnId, {
              error: codexAppServerNotificationError(notification),
              provider,
              status,
              usageLimitExceeded: codexAppServerNotificationUsageLimitExceeded(notification),
              deferFailureDetails: true
            });
          });
          return;
        }
        if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
          runCodexAppServerNotificationTask(notificationContext, () => {
            return completeCodexAppServerTurn(normalizedSessionId, normalizedThreadId, turnId, {
              provider,
              status
            });
          });
        }
        return;
      }
      if (method === "thread/status/changed") {
        const status = codexAppServerNotificationTurnStatus(notification);
        if (codexAppServerTurnStatusIsActive(status)) {
          runCodexAppServerNotificationTask(notificationContext, async () => {
            const turnId = await resolveCodexAppServerTurnId(
              normalizedSessionId,
              normalizedThreadId,
              codexAppServerNotificationTurnId(notification)
            );
            await markCodexAppServerProviderTurnActive(normalizedSessionId, {
              source: "thread_status_changed",
              status,
              threadId: normalizedThreadId,
              turnId
            });
          });
          return;
        }
        codexAppServerAutomaticHookThreads.delete(normalizedThreadId);
        const turnId = codexAppServerNotificationTurnId(notification);
        if (codexAppServerTurnStatusIsProviderFailure(status)) {
          runCodexAppServerNotificationTask(notificationContext, () => {
            return stopCodexAppServerTurnWithProviderFailure(normalizedSessionId, normalizedThreadId, turnId, {
              error: codexAppServerNotificationError(notification),
              provider,
              status,
              usageLimitExceeded: codexAppServerNotificationUsageLimitExceeded(notification),
              deferFailureDetails: true
            });
          });
          return;
        }
        if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
          runCodexAppServerNotificationTask(notificationContext, async () => {
            const resolvedTurnId = await resolveCodexAppServerTurnId(
              normalizedSessionId,
              normalizedThreadId,
              turnId
            );
            return completeCodexAppServerTurn(normalizedSessionId, normalizedThreadId, resolvedTurnId, {
              provider,
              status
            });
          });
        }
      }
    };
    let unsubscribeNotifications;
    try {
      unsubscribeNotifications = provider.subscribe(onNotification);
      if (typeof unsubscribeNotifications !== "function") {
        throw new Error("Codex observation requires an unsubscribe function.");
      }
    } catch (error) {
      provider.failObservation(error);
      throw error;
    }
    codexAppServerEventSubscriptions.set(key, {
      connectionGeneration: codexAppServerProviderConnectionGeneration(provider),
      unsubscribe: unsubscribeNotifications
    });
    return {
      ok: true,
      status: existing ? "resubscribed" : "subscribed"
    };
  }

  return {
    eventSubscriptions: codexAppServerEventSubscriptions,
    automaticHookThreads: codexAppServerAutomaticHookThreads,
    eventSubscriptionKey: codexAppServerEventSubscriptionKey,
    eventSubscriptionIsCurrent: codexAppServerEventSubscriptionIsCurrent,
    unsubscribeEventSubscription: unsubscribeCodexAppServerEventSubscription,
    reconcileGoalUpdated: reconcileCodexAppServerGoalUpdated,
    subscribeEvents: subscribeCodexAppServerEvents
  };
}
