import { codexAppServerTurnStatusIsSuccessfulComplete, codexAppServerTurnStatusIsProviderFailure, normalizeCodexRunText } from "./codexTurnState.js";
import { CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS, createCodexAppServerDetachedTurnWatcher } from "./codexDetachedTurn.js";
import { assertCodexAppServerHelperAccountIdentity } from "./codexHelperExecution.js";
import { prepareCodexAppServerConversationThread } from "./codexConversationTurns.js";
import { codexAppServerDeliveredTurn, sendCodexAppServerPrompt } from "./codexProviderTurns.js";

function ignoreDetachedConversationEvent() {}

export async function acquireCodexAppServerDetachedThread(provider, requestedThreadId, threadSettings, input = {}) {
  let thread = null;
  if (requestedThreadId) {
    thread = await provider.resumeThread(requestedThreadId, threadSettings);
  }
  if (!thread) {
    thread = await provider.startThread({
      ...threadSettings,
      ...(input.ephemeral === true ? { ephemeral: true } : {})
    });
  }
  return thread;
}

export function codexAppServerDetachedThreadId(thread, requestedThreadId) {
  const threadId = normalizeCodexRunText(thread.id || thread.response?.thread?.id || requestedThreadId);
  if (!threadId) {
    throw new Error("Codex app-server did not return a detached chat thread id.");
  }
  return threadId;
}

export async function dispatchCodexAppServerDetachedTurn({ provider, prompt, threadId }, authorized) {
  const delivery = await sendCodexAppServerPrompt({ provider, prompt, threadId }, authorized);
  return { delivery, ...codexAppServerDeliveredTurn(delivery) };
}

export async function runDetachedCodexAppServerTurn({
  provider,
  threadId,
  timeoutMs,
  onEvent: emitDetachedEvent,
  onFailure
} = {}, operation) {
  const watcher = createCodexAppServerDetachedTurnWatcher(provider, threadId, {
    onEvent: (classification) => {
      emitDetachedEvent({
        classification,
        threadId,
        turnId: classification.turnId,
        type: "notification"
      });
    },
    timeoutMs
  });
  const waitForResult = watcher.wait();
  void waitForResult.catch(() => null);
  const throwWatcherFailure = async (fallbackError, status = "", {
    waitForDetail = false
  } = {}) => {
    if (waitForDetail) {
      watcher.failAfterDetailGrace(fallbackError);
    } else {
      watcher.failNow(fallbackError);
    }
    const error = await waitForResult.then(
      () => fallbackError,
      (watcherError) => watcherError
    );
    throw await onFailure(error, status);
  };
  const { delivery, status, turnId } = await operation(throwWatcherFailure);
  watcher.setTurnId(turnId);
  emitDetachedEvent({
    status,
    threadId,
    turnId,
    type: "turn"
  });
  if (codexAppServerTurnStatusIsProviderFailure(status)) {
    const error = new Error(codexAppServerDeliveredTurn(delivery).error || `Codex app-server turn ${status}.`);
    await throwWatcherFailure(error, status, {
      waitForDetail: true
    });
  }
  if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
    await watcher.completeNow(status);
  }
  let result = null;
  try {
    result = await waitForResult;
  } catch (error) {
    throw await onFailure(error, status);
  }
  return result;
}

/**
 * A detached conversation: one prompt on a resumed or fresh native thread, watched until its turn completes.
 * A Helper's turn runs on its retained Helper thread instead.
 * @param {object} dependencies
 * @param {object} dependencies.conversationPreparation The application's conversation preparation.
 * @param {import("./codexConversations.js").CodexConversationResult} dependencies.codexAppServerConversationResult
 * @param {import("./codexConversations.js").CodexConversationContextReader} dependencies.codexAppServerConversationContext
 * @param {import("./codexHelperThreads.js").CodexHelperThreadLifecycle} dependencies.helperLifecycle
 * @param {string} dependencies.helperOwnershipError
 */
export function createCodexDetachedConversation({
  conversationPreparation,
  codexAppServerConversationResult,
  codexAppServerConversationContext,
  helperLifecycle,
  helperOwnershipError
}) {
  async function runDetachedCodexAppServerConversation(sessionId, input = {}, options = {}) {
    const preparation = conversationPreparation.detached(sessionId, input);
    const { admission } = preparation;
    if (admission.ok === false) return admission;
    try {
      return await codexAppServerConversationResult(async () => {
        const unavailable = preparation.result;
        if (unavailable) return unavailable;
        const prompt = preparation.prompt;
        const context = await codexAppServerConversationContext(sessionId, input, options);
        if (context.ok === false) return context;
        const { provider, runtime, workdir } = context;
        const executionProfile = input.executionProfile && typeof input.executionProfile === "object" &&
          !Array.isArray(input.executionProfile) ? input.executionProfile : null;
        const helperTurn = Boolean(executionProfile);
        const emitDetachedEvent = options.onEvent || ignoreDetachedConversationEvent;
        const onRetired = ({ threadId }) => emitDetachedEvent({ threadId, type: "thread-retired" });
        if (helperTurn) {
          await assertCodexAppServerHelperAccountIdentity(provider, input.expectedAccountIdentitySignature, helperOwnershipError);
        }
        const execution = preparation.execution(context);
        const threadSettings = helperTurn ? null : await prepareCodexAppServerConversationThread(
          provider, execution.threadPreparation, conversationPreparation.isolation
        );
        const requestedThreadId = normalizeCodexRunText(input.threadId || input.codexSessionId);
        let helper = null;
        let thread;
        if (helperTurn) {
          const scope = { executionProfile, onRetired, projectRuntimeRoot: normalizeCodexRunText(runtime?.stateRoot),
            projectContextRoot: normalizeCodexRunText(runtime?.projectContextRoot), provider, sessionId, requestedThreadId, workdir,
            ...(requestedThreadId ? { record: helperLifecycle.threadForOperation({ executionProfile,
              projectRuntimeRoot: normalizeCodexRunText(runtime?.stateRoot), provider, sessionId,
              threadId: requestedThreadId, workdir }) } : {}) };
          helper = await helperLifecycle.prepareDetached(scope, execution.helperPreparation);
          thread = helper.thread;
        } else {
          thread = await acquireCodexAppServerDetachedThread(provider, requestedThreadId, threadSettings, input);
        }
        const threadId = codexAppServerDetachedThreadId(thread, requestedThreadId);
        emitDetachedEvent({ threadId, type: "thread" });
        const requestedTimeoutMs = Number(input.timeoutMs || 0);
        const profileTimeoutMs = Number(executionProfile?.limits?.timeoutMs || 0);
        let turnId = "";
        const result = await runDetachedCodexAppServerTurn({
          provider, threadId, onEvent: emitDetachedEvent,
          timeoutMs: helperTurn
            ? Math.min(requestedTimeoutMs > 0 ? requestedTimeoutMs : profileTimeoutMs, profileTimeoutMs)
            : requestedTimeoutMs > 0 ? requestedTimeoutMs : CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS,
          async onFailure(error, status) {
            await helper?.discard();
            return execution.failure(error, status);
          }
        }, async failDispatch => {
          let dispatched;
          if (helperTurn) {
            dispatched = await helper.dispatch(threadId, failDispatch);
          } else {
            try {
              dispatched = await dispatchCodexAppServerDetachedTurn({ provider, prompt, threadId }, execution.authorized);
            } catch (error) {
              await failDispatch(error);
            }
          }
          turnId = dispatched.turnId;
          return dispatched;
        });
        if (helperTurn) {
          try {
            await assertCodexAppServerHelperAccountIdentity(provider, input.expectedAccountIdentitySignature, helperOwnershipError);
            execution.validateOutput(result.text);
          } catch (error) {
            await helper.discard();
            throw error;
          }
          await helper.complete();
        }
        emitDetachedEvent({ status: result.status || "completed", text: result.text,
          threadId, turnId: result.turnId || turnId, type: "completed" });
        return { ok: true, text: result.text, threadId, turnId: result.turnId || turnId,
          ...(helperTurn ? { inputCharacters: prompt.length, outputCharacters: result.text.length, usage: result.usage || null } : {}) };
      });
    } finally {
      admission.release();
    }
  }

  return Object.freeze({ runDetachedCodexAppServerConversation });
}

/** @typedef {ReturnType<typeof createCodexDetachedConversation>} CodexDetachedConversation */
