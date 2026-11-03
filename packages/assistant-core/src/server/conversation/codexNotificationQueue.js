import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function ignoreNotificationTaskError() {}

/**
 * Per-session ordered notification tasks. Coalesces only fragments still
 * waiting behind a running write; running batches are never merged or delayed.
 * @param {object} [options]
 * @param {import("./codexTurn.js").CodexSessionNamespace} [options.namespace]
 * @param {() => boolean} [options.isClosing]
 * @param {import("./codexTurn.js").CodexRunInContext} [options.runInContext]
 * @param {(error: unknown, context: object) => void} [options.reportError]
 */
export function createCodexAppServerNotificationQueue({
  namespace = normalizeText,
  isClosing = () => false,
  runInContext = (_context, operation) => operation(),
  reportError = ignoreNotificationTaskError
} = {}) {
  const codexAppServerNotificationTasks = new Map();
  const codexAppServerPendingStreams = new Map();
  const codexAppServerPendingReasoning = new Map();

  function runCodexAppServerNotificationTask(context = {}, operation = async () => null) {
    if (isClosing()) {
      return;
    }
    const taskSessionId = normalizeText(context.sessionId);
    const taskSessionKey = normalizeText(context.sessionKey) ||
      namespace(taskSessionId);
    // Other notifications end the pending stream batch so completion, reasoning
    // and turn changes retain their position in the provider's event order.
    codexAppServerPendingStreams.delete(taskSessionKey);
    codexAppServerPendingReasoning.delete(taskSessionKey);
    const previous = codexAppServerNotificationTasks.get(taskSessionKey) || Promise.resolve();
    const task = previous
      .catch(() => null)
      .then(() => runInContext(context.projectContext, operation))
      .catch((error) => {
        context.provider?.failObservation(error);
        reportError(error, context);
      });
    codexAppServerNotificationTasks.set(taskSessionKey, task);
    void task.finally(() => {
      if (codexAppServerNotificationTasks.get(taskSessionKey) === task) {
        codexAppServerNotificationTasks.delete(taskSessionKey);
      }
    });
  }

  async function drainCodexAppServerNotificationTasksForKey(taskSessionKey) {
    while (true) {
      const task = codexAppServerNotificationTasks.get(taskSessionKey);
      if (!task) {
        return;
      }
      await task;
    }
  }

  async function drainCodexAppServerNotificationTasks(sessionId = "") {
    return drainCodexAppServerNotificationTasksForKey(namespace(sessionId));
  }

  function captureCodexAppServerNotificationDrain(sessionId = "") {
    const taskSessionKey = namespace(sessionId);
    return () => drainCodexAppServerNotificationTasksForKey(taskSessionKey);
  }

  function queueCodexAppServerStream(context, classification, deliver) {
    if (isClosing() || !classification.itemId || !classification.turnId) return;
    const pending = codexAppServerPendingStreams.get(context.sessionKey);
    if (classification.kind === "assistant_delta" && pending &&
        pending.threadId === classification.threadId &&
        pending.turnId === classification.turnId && pending.itemId === classification.itemId) {
      pending.delta += classification.delta;
      return;
    }
    const stream = { ...classification, delta: classification.delta || "" };
    runCodexAppServerNotificationTask(context, () => {
      if (codexAppServerPendingStreams.get(context.sessionKey) === stream) {
        codexAppServerPendingStreams.delete(context.sessionKey);
      }
      return deliver(context.sessionId, stream);
    });
    // Combine only fragments still waiting for delivery. The running write owns
    // an immutable batch; there is no timer or delay before the next write.
    codexAppServerPendingStreams.set(context.sessionKey, stream);
  }

  function queueCodexAppServerReasoning(context, notification, deliver) {
    if (isClosing()) return;
    const pending = codexAppServerPendingReasoning.get(context.sessionKey);
    if (pending && pending.threadId === context.threadId && pending.turnId === context.turnId) {
      pending.notifications.push(notification);
      return;
    }
    const batch = { threadId: context.threadId, turnId: context.turnId, notifications: [notification] };
    runCodexAppServerNotificationTask(context, () => {
      if (codexAppServerPendingReasoning.get(context.sessionKey) === batch) {
        codexAppServerPendingReasoning.delete(context.sessionKey);
      }
      return deliver(context.sessionId, context.threadId, batch.notifications);
    });
    // Merge only work waiting behind a write. Other notifications close this
    // batch, preserving commentary and turn boundaries without a timer.
    codexAppServerPendingReasoning.set(context.sessionKey, batch);
  }

  return Object.freeze({
    tasks: codexAppServerNotificationTasks,
    pendingStreams: codexAppServerPendingStreams,
    pendingReasoning: codexAppServerPendingReasoning,
    run: runCodexAppServerNotificationTask,
    drain: drainCodexAppServerNotificationTasks,
    captureDrain: captureCodexAppServerNotificationDrain,
    stream: queueCodexAppServerStream,
    reasoning: queueCodexAppServerReasoning
  });
}

/** @typedef {ReturnType<typeof createCodexAppServerNotificationQueue>} CodexAppServerNotificationQueue */
