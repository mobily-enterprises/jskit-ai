import { codexAppServerTurnStatusIsSuccessfulComplete, codexAppServerTurnStatusIsProviderFailure, normalizeCodexRunText, codexAppServerErrorMessage } from "./codexTurnState.js";
import { createCodexAppServerDetachedTurnWatcher, waitForCodexAppServerTurn } from "./codexDetachedTurn.js";
import { resumeExactCodexAppServerThread, startFreshCodexAppServerThread, sendCodexAppServerPrompt } from "./codexProvider.js";
import { codexAppServerProviderTurnId, codexAppServerProviderTurnError, inspectCodexAppServerRenewalThread } from "./codexEvents.js";

// Private composition of unchanged operations from the original run owner.
export function createCodexRenewalCommands({
  claimCodexAppServerTurnStart,
  codexAppServerNotificationQueue,
  completeCodexAppServerTurn,
  errorPrefix,
  markCodexAppServerTurnActive,
  markCodexAppServerTurnIdle,
  observer,
  selection,
  turnAlreadyRunningError,
  writeCodexAppServerUserMessageOwnership
}) {
  async function runCodexAppServerRenewalHandover(sessionId, input = {}, context = {}) {
    const { clientMessageId, operationId, timeoutMs } = input;
    const { runtime, provider, errors } = context;
    const resumed = await resumeExactCodexAppServerThread(context.threadPreparation);
    const threadId = resumed.threadId;
    const expectedTurnId = context.readExpectedTurnId(threadId);
    const { targetTurn, failure: snapshotFailure } = inspectCodexAppServerRenewalThread(resumed.threadSnapshot, {
      clientMessageId,
      turnId: expectedTurnId
    });
    if (snapshotFailure === "turn_missing") {
      throw errors.withIdentity(
        errors.create("handover_turn_missing"),
        { clientMessageId, operationId, threadId, turnId: expectedTurnId }
      );
    }
    if (snapshotFailure === "history_missing") {
      throw errors.withIdentity(
        errors.create("handover_history_missing"),
        { clientMessageId, operationId, threadId }
      );
    }

    observer.subscribeEvents(sessionId, provider, threadId,
      selection.codexAppServerSessionObserverOptions(sessionId, context.providerOptions));
    selection.rememberCodexAppServerPreparedThread(sessionId, context.providerOptions, context, resumed);

    let result = null;
    let reconciled = Boolean(targetTurn);
    let turnId = codexAppServerProviderTurnId(targetTurn || {});
    if (targetTurn) {
      try {
        result = await waitForCodexAppServerTurn(
          provider,
          threadId,
          targetTurn,
          { timeoutMs, createError: errors.create }
        );
      } catch (error) {
        throw errors.withIdentity(error, {
          clientMessageId,
          operationId,
          threadId,
          turnId
        });
      }
    } else {
      const claim = await claimCodexAppServerTurnStart(
        runtime,
        sessionId,
        clientMessageId,
        { inputSource: "session_renewal_handover" }
      );
      if (!claim?.claimed) {
        return { response: claim?.response || {
          code: `${errorPrefix}agent_turn_already_running`,
          error: turnAlreadyRunningError,
          ok: false
        } };
      }
      // The exact old thread is already known before prompt delivery. Bind
      // it to the durable claim now, so an immediate provider response can
      // supply the turn id and complete the run even when its notifications
      // arrive before sendTurn() returns.
      await markCodexAppServerTurnActive(sessionId, {
        status: "starting",
        threadId
      });
      await context.writeMetadata({
        clientMessageId,
        operationId,
        threadId
      });
      await writeCodexAppServerUserMessageOwnership(
        runtime.store,
        sessionId,
        clientMessageId,
        {
          eventKind: "codex-app-server-renewal-handover-owned",
          owned: true
        }
      );
      const watcher = createCodexAppServerDetachedTurnWatcher(provider, threadId, {
        timeoutMs
      });
      const pending = watcher.wait();
      void pending.catch(() => null);
      let delivery = null;
      let status = "";
      try {
        delivery = await sendCodexAppServerPrompt({
          clientUserMessageId: clientMessageId,
          prompt: input.prompt,
          provider,
          threadId
        }, context);
        turnId = normalizeCodexRunText(delivery.turn?.id);
        status = normalizeCodexRunText(delivery.turn?.status || delivery.turn?.raw?.status);
        if (!turnId) {
          throw errors.create("handover_identity_missing");
        }
        await context.writeMetadata({ turnId });
        await markCodexAppServerTurnActive(sessionId, {
          requireTrackedTurn: true,
          status: "inProgress",
          threadId,
          turnId
        });
        watcher.setTurnId(turnId);
        if (codexAppServerTurnStatusIsProviderFailure(status)) {
          watcher.failAfterDetailGrace(errors.create(
            "failed",
            { status },
            codexAppServerProviderTurnError(delivery.turn || {})
          ));
        } else if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
          await watcher.completeNow(status);
        }
        result = await pending;
      } catch (error) {
        watcher.failNow(error);
        await writeCodexAppServerUserMessageOwnership(
          runtime.store,
          sessionId,
          clientMessageId,
          {
            eventKind: "codex-app-server-renewal-handover-released",
            owned: false
          }
        );
        await markCodexAppServerTurnIdle(sessionId, {
          error: codexAppServerErrorMessage(error, "Codex handover generation failed."),
          status: "failed",
          threadId,
          turnId
        });
        throw errors.withIdentity(error, {
          clientMessageId,
          operationId,
          threadId,
          turnId
        });
      }
    }

    await codexAppServerNotificationQueue.drain(sessionId);
    if (codexAppServerTurnStatusIsSuccessfulComplete(result.status)) {
      // A reconciled turn may already be complete before this process
      // subscribes, so no completion notification is guaranteed. Route it
      // through the ordinary finalizer as well; its turn identity guards
      // make the live-notification case an idempotent no-op.
      await completeCodexAppServerTurn(
        sessionId,
        threadId,
        result.turnId || turnId,
        {
          provider,
          status: result.status,
          verifyInactive: false
        }
      );
    }
    return { result, reconciled, turnId, threadId };
  }

  async function runCodexAppServerRenewalSeed(input = {}, context = {}) {
    const { clientMessageId, operationId, timeoutMs } = input;
    const { provider, errors } = context;
    const started = await startFreshCodexAppServerThread(context.threadPreparation);
    const threadId = started.threadId;
    const expectedTurnId = context.readExpectedTurnId(threadId);
    const { targetTurn, failure: snapshotFailure } = inspectCodexAppServerRenewalThread(started.threadSnapshot, {
      clientMessageId,
      turnId: expectedTurnId,
      requireFresh: true
    });
    if (snapshotFailure === "turn_missing") {
      throw errors.withIdentity(
        errors.create("seed_turn_missing"),
        { clientMessageId, operationId, threadId, turnId: expectedTurnId }
      );
    }
    if (snapshotFailure === "unrelated_history") {
      throw errors.withIdentity(
        errors.create("seed_unrelated_history"),
        {
          clientMessageId,
          operationId,
          threadId,
          turnId: codexAppServerProviderTurnId(targetTurn || {})
        }
      );
    }

    let result = null;
    let turnId = codexAppServerProviderTurnId(targetTurn || {});
    const reconciled = Boolean(targetTurn);
    if (targetTurn) {
      try {
        result = await waitForCodexAppServerTurn(provider, threadId, targetTurn, {
          timeoutMs, createError: errors.create
        });
      } catch (error) {
        throw errors.withIdentity(error, {
          clientMessageId,
          handoverPromptAccepted: true,
          operationId,
          threadId,
          turnId
        });
      }
    } else {
      await context.writeMetadata({
        clientMessageId,
        operationId,
        threadId
      });
      const watcher = createCodexAppServerDetachedTurnWatcher(provider, threadId, {
        timeoutMs
      });
      const pending = watcher.wait();
      void pending.catch(() => null);
      let delivery = null;
      let handoverPromptAccepted = false;
      let status = "";
      try {
        delivery = await sendCodexAppServerPrompt({
          clientUserMessageId: clientMessageId,
          outputSchema: input.outputSchema,
          prompt: input.prompt,
          provider,
          readOnly: true,
          threadId
        }, context);
        turnId = normalizeCodexRunText(delivery.turn?.id);
        status = normalizeCodexRunText(delivery.turn?.status || delivery.turn?.raw?.status);
        if (!turnId) {
          throw errors.create("seed_identity_missing");
        }
        handoverPromptAccepted = true;
        await context.writeMetadata({ turnId });
        watcher.setTurnId(turnId);
        if (codexAppServerTurnStatusIsProviderFailure(status)) {
          watcher.failAfterDetailGrace(errors.create(
            "failed",
            { status },
            codexAppServerProviderTurnError(delivery.turn || {})
          ));
        } else if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
          await watcher.completeNow(status);
        }
        result = await pending;
      } catch (error) {
        watcher.failNow(error);
        throw errors.withIdentity(error, {
          clientMessageId,
          handoverPromptAccepted,
          operationId,
          threadId,
          turnId
        });
      }
    }
    return { result, reconciled, turnId, threadId, freshThread: started.fresh };
  }


  return {
    runCodexAppServerRenewalHandover,
    runCodexAppServerRenewalSeed
  };
}
