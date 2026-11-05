import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import {
  OPENCODE_INTERRUPT_TIMEOUT_MS, inspectOpenCodeMessageAdmission, openCodeMessageRows, dispatchOpenCodeTurn, runOpenCodeConversationTurn
} from "./openCodeTurn.js";
import { ensureOpenCodeSession, sameOpenCodeSelection } from "./openCodeNativeSession.js";
import { openCodeTurnSnapshot } from "./openCodeTurnMonitor.js";
import { normalizeNullableText } from "./normalize.js";
import { ignorePromptRejection } from "./nativeCommandCallbacks.js";

/**
 * A session's main native conversation: its readiness, the messages sent to
 * it, its renewal turn, its interrupt, and the reconciliation of saved runs
 * after a restart.
 * @param {{
 *   processes: Map<string, object>,
 *   monitors: Map<string, Promise<object>>,
 *   turns: Map<string, object>,
 *   processOwner: import("./openCodeProcessOwner.js").OpenCodeProcessOwner,
 *   turnMonitor: import("./openCodeTurnMonitor.js").OpenCodeTurnMonitor
 * }} options
 */
export function createOpenCodeSessionTurns({ processes, monitors, turns, processOwner, turnMonitor }) {
  async function runPreparedRenewalTurn(preparation) {
    const acquired = await processOwner.acquirePrepared(await preparation.process());
    const releaseDirectory = await processOwner.admitDirectory(acquired.workdir);
    try {
      const target = await ensureOpenCodeSession(acquired, preparation.session());
      const turn = preparation.turn(target);
      const result = await runOpenCodeConversationTurn(target.server.client, target.upstreamSessionId, turn.input, {
        ...turn.options,
        ...(turn.release ? { close: () => processOwner.releaseProcessTarget(target, {}, turn.release) } : {})
      });
      return turn.completeResult(result);
    } finally {
      releaseDirectory();
    }
  }

  async function sendPreparedMessage(prepared, options) {
    if (Object.hasOwn(prepared, "value")) return prepared.value;
    return prepared.project(await sendMessage(prepared.key, prepared.input, options, prepared.application));
  }

  async function inspectPreparedMessage(prepared) {
    const target = await processOwner.acquirePrepared(prepared.process);
    const observation = await inspectOpenCodeMessageAdmission(target.server.client, prepared.threadId, prepared.inputMessageId);
    return prepared.project(observation);
  }

  async function interruptPreparedTurn(prepared) {
    const target = processes.get(prepared.key) || null;
    return interruptTurn(prepared.key, target, {
      threadId: target ? "" : prepared.threadId, writeRun: prepared.writeRun
    }).catch(prepared.failure);
  }

  async function sendMessage(key, input, options, application) {
    if (input.duplicate) {
      const currentTurn = openCodeTurnSnapshot(turns.get(key));
      return {
        delivered: true,
        duplicate: true,
        ok: true,
        thread: { id: currentTurn?.threadId || input.threadId },
        turn: currentTurn
      };
    }
    const currentTurn = turns.get(key);
    if (currentTurn?.observationError) {
      await monitors.get(key);
    }
    if (currentTurn?.active && currentTurn.observationError) {
      // An explicit Send may retry stopping uncertain work, but cannot overlap it.
      try {
        await processOwner.stopUnobservedSession(processes.get(key), currentTurn.threadId);
      } catch (error) {
        return { failure: { error, recovery: true } };
      }
      currentTurn.active = false;
      currentTurn.state = "interrupted";
      await application.writeRun(currentTurn, "interrupted", currentTurn.observationError);
    }
    let currentMonitor = monitors.get(key);
    let currentThreadId = input.threadId;
    const ownershipMatchesTurn = Boolean(
      currentMonitor &&
      options.turnOwnership &&
      normalizeNullableText(options.turnOwnership.threadId) === currentThreadId &&
      normalizeNullableText(options.turnOwnership.turnId) === normalizeNullableText(currentTurn?.id)
    );
    if (ownershipMatchesTurn && options.turnOwnership.reusable !== true) {
      return { ownerConflict: true, threadId: currentThreadId,
        turn: openCodeTurnSnapshot(currentTurn, currentThreadId) };
    }
    const eventStartedAt = Date.now();
    const startedAt = new Date(eventStartedAt).toISOString();
    const providerMessageId = input.id;
    const startingTurn = currentMonitor
      ? null
      : {
          active: true,
          error: "",
          eventStartedAt,
          id: providerMessageId,
          inputMessageId: providerMessageId,
          startedAt,
          state: "starting",
          threadId: currentThreadId,
          updatedAt: startedAt
        };
    if (startingTurn) {
      turns.set(key, startingTurn);
      await application.writeRun(startingTurn, "starting");
    }
    let admitted = null;
    let target = null;
    let admission = null;
    let dispatchTurn = null;
    let dispatchMonitor = null;
    let previousInputMessageId = null;
    let previousAdmission;
    let recoveryReceipt = null;
    let recoveryObservationError = null;
    try {
      const preparation = await application.prepare({ overwrite: !currentMonitor, threadId: currentThreadId });
      const preparedTarget = preparation.process ? await processOwner.acquirePrepared(preparation.process) : preparation.target;
      if (!monitors.get(key)) await processOwner.currentDirectory(preparedTarget.workdir);
      target = await ensureOpenCodeSession(preparedTarget, preparation.session);
      currentThreadId = target.upstreamSessionId;
      if (startingTurn) {
        startingTurn.threadId = currentThreadId;
      }
      const prompt = await application.prompt();
      // Preparation can outlive the preceding turn's final projection. Do not
      // attach a new input to a monitor that has already claimed retirement.
      currentMonitor = monitors.get(key);
      if (currentMonitor && !turns.get(key)?.active) {
        await currentMonitor;
        currentMonitor = monitors.get(key);
      }
      const recoveryTurn = currentMonitor ? turns.get(key) : null;
      if (recoveryTurn?.recoveryAdmission) {
        try {
          recoveryReceipt = await recoveryTurn.recoveryAdmission.promise;
          currentMonitor = monitors.get(key);
          if (currentMonitor && !turns.get(key)?.active) {
            await currentMonitor;
            currentMonitor = monitors.get(key);
          }
          // Stop must not turn a waiting, undispatched input into a fresh turn.
          recoveryTurn.abortController.signal.throwIfAborted();
          target.abortController.signal.throwIfAborted();
        } catch (error) {
          // This is R's failure, not a rejected or attempted native B input.
          return { failure: { error, attempted: false, threadId: currentThreadId,
            turn: openCodeTurnSnapshot(turns.get(key), currentThreadId) } };
        }
      }
      // A new native turn starts only on its directory's current credentials;
      // the wait, if any, is for that directory's own running turns.
      while (!currentMonitor && !processOwner.directoryCurrent(target.workdir)) {
        await processOwner.waitForDirectory(target.workdir);
        currentMonitor = monitors.get(key);
        if (currentMonitor && !turns.get(key)?.active) {
          await currentMonitor;
          currentMonitor = monitors.get(key);
        }
      }
      admission = Promise.withResolvers();
      // The observer may be between polls when dispatch or persistence fails.
      // Keep the raw promise rejectable without an unhandled rejection.
      void admission.promise.catch(() => {});
      let eventReady = null;
      if (currentMonitor) {
        dispatchTurn = turns.get(key);
        previousInputMessageId = dispatchTurn.inputMessageId;
        previousAdmission = dispatchTurn.admission;
        dispatchTurn.admission = admission;
        dispatchTurn.inputMessageId = providerMessageId;
        dispatchTurn.updatedAt = new Date().toISOString();
        dispatchMonitor = currentMonitor;
      } else {
        eventReady = Promise.withResolvers();
        dispatchMonitor = turnMonitor.beginMessageMonitor(key, target, { id: providerMessageId, eventStartedAt, startedAt }, {
          ...options, admission, eventReady
        }, application.monitor);
        dispatchTurn = turns.get(key);
      }
      admitted = await dispatchOpenCodeTurn(dispatchTurn, {
        get agent() { return prompt.agent; },
        delivery: currentMonitor ? "steer" : "queue",
        id: providerMessageId,
        get model() { return prompt.model; },
        get prompt() { return prompt.prompt; },
        get attachments() { return prompt.attachments; }
      }, {
        get client() { return target.server.client; },
        get conversationId() { return target.upstreamSessionId; },
        events: eventReady ? { waitUntilReady: () => eventReady.promise } : null,
        get signal() {
          return AbortSignal.any([
            target.abortController.signal,
            turns.get(key).abortController.signal
          ]);
        },
        beforeDispatch: () => prompt.beforeDispatch(target.upstreamSessionId),
        promptTimeoutMs: options.promptTimeoutMs,
        authorizeAttachments: prompt.authorizeAttachments
      });
    } catch (error) {
      const rejected = error?.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408;
      const retainPreviousInput = previousInputMessageId !== null &&
        (dispatchTurn?.promptAttempted !== true || rejected);
      if (retainPreviousInput) {
        if (dispatchTurn.admission === admission && dispatchTurn.inputMessageId === providerMessageId) {
          dispatchTurn.inputMessageId = previousInputMessageId;
          dispatchTurn.admission = previousAdmission;
        }
        admission.resolve();
      } else {
        // Attempted unknown admission must retain the new input and use the
        // same observer's original Stop/error recovery, never roll back to A.
        admission?.reject(error);
        dispatchTurn?.abortController?.abort(error);
      }
      if (rejected) {
        const { onPromptRejected = ignorePromptRejection } = input;
        await onPromptRejected();
      }
      if (admission && !retainPreviousInput) await dispatchMonitor;
      if (startingTurn && !admission && !monitors.has(key)) {
        startingTurn.active = false;
        startingTurn.error = normalizeNullableText(error?.message) || "OpenCode prompt delivery failed.";
        startingTurn.state = "failed";
        startingTurn.updatedAt = new Date().toISOString();
        await application.writeRun(
          startingTurn,
          "failed",
          startingTurn.error
        ).catch(() => null);
      }
      return { failure: { error, attempted: dispatchTurn?.promptAttempted === true, threadId: currentThreadId,
        turn: openCodeTurnSnapshot(turns.get(key) || startingTurn, currentThreadId) } };
    }
    if (dispatchTurn.admission === admission && dispatchTurn.inputMessageId === providerMessageId) {
      dispatchTurn.inputMessageId = normalizeNullableText(admitted.id);
      dispatchTurn.updatedAt = new Date().toISOString();
    }
    let conversationTurn;
    try {
      conversationTurn = await application.commit(admitted);
    } catch (error) {
      admission.reject(error);
      dispatchTurn.abortController.abort(error);
      // Preserve the persistence error while joining the original recovery.
      await dispatchMonitor.catch(() => null);
      throw error;
    }
    if (recoveryReceipt) {
      const receiptAbort = new AbortController();
      // The original monitor can fail and retire without aborting its turn.
      // Its settlement also ends this read; it never creates a successor turn.
      void dispatchMonitor.then(() => receiptAbort.abort(new Error(
        dispatchTurn.observationError || dispatchTurn.error || "OpenCode observation ended before input custody was confirmed."
      )), error => receiptAbort.abort(error));
      try {
        const observation = await inspectOpenCodeMessageAdmission(target.server.client, currentThreadId,
          normalizeNullableText(admitted.id), { wait: true, signal: AbortSignal.any([
            target.abortController.signal, dispatchTurn.abortController.signal, receiptAbort.signal
          ]) });
        const message = openCodeMessageRows(observation.messages).find(message =>
          message.type === "user" && normalizeNullableText(message.id) === normalizeNullableText(admitted.id));
        const created = message?.time?.created;
        const recoveryCreated = recoveryReceipt.time?.created;
        // Match the native latest-user order, including its ID tie-breaker.
        if (!Number.isFinite(created) || !Number.isFinite(recoveryCreated) ||
            !(created > recoveryCreated || (created === recoveryCreated && message.id > recoveryReceipt.id))) {
          throw new AppError(503,
            "OpenCode could not confirm that the new input follows its final-answer recovery. The admitted message was not resent.",
            { code: "assistant_opencode_recovery_order_unconfirmed", details: {} });
        }
      } catch (error) {
        recoveryObservationError = error;
      } finally {
        receiptAbort.abort();
      }
    }
    if (recoveryObservationError) {
      // Native B was dispatched: keep its authored receipt even when observing
      // its place in native history failed, and use the original cleanup owner.
      admission.reject(recoveryObservationError);
      dispatchTurn.abortController.abort(recoveryObservationError);
      await dispatchMonitor.catch(() => null);
    } else {
      admission.resolve();
    }
    const turn = openCodeTurnSnapshot(turns.get(key), target.upstreamSessionId);
    return {
      conversationTurn,
      delivered: true,
      deliveryMode: currentMonitor ? "steer" : "new_turn",
      ok: true,
      thread: { id: target.upstreamSessionId },
      turn,
      workdir: input.workdir
    };
  }

  async function reconcileSessions(sessions = [], options = {}, preparation) {
    const results = [];
    for (const session of sessions) {
      const sessionId = normalizeNullableText(session?.sessionId || session?.id);
      try {
        const prepared = await preparation.session(sessionId, session, options);
        const resumed = await reconcilePreparedSession(prepared, prepared.activeRun, options);
        results.push({ ok: true, resumed, sessionId });
      } catch (error) {
        results.push({ error: normalizeNullableText(error?.message), ok: false, sessionId });
      }
    }
    return {
      failed: results.filter((result) => result.ok === false),
      ok: results.every((result) => result.ok),
      results,
      sessionCount: results.length
    };
  }

  async function reconcilePreparedSession(prepared, activeRun, options) {
    const target = await processOwner.acquirePrepared(await prepared.process());
    const current = await ensureOpenCodeSession(target, prepared.session());
    return reconcileSessionTurn(prepared.key, current, activeRun, options, prepared.observation).catch(prepared.failure);
  }

  async function reconcileSessionTurn(key, target, activeRun, options, application) {
    if (endedOnPreviousServer(activeRun)) {
      await processOwner.stopUnobservedSession(target, activeRun.threadId);
      await application.writeRun({ ...activeRun, id: activeRun.turnId }, "interrupted", activeRun.observationError);
    } else if (activeRun) {
      turnMonitor.beginMessageMonitor(key, target, {
        restored: true,
        eventStartedAt: Date.parse(normalizeNullableText(activeRun.startedAt)) || Date.now(),
        id: normalizeNullableText(activeRun.turnId) || application.fallbackTurnId,
        startedAt: normalizeNullableText(activeRun.startedAt)
      }, options, application.monitor);
    }
    return Boolean(activeRun && !endedOnPreviousServer(activeRun));
  }

  async function ensurePreparedSessionReadiness(prepared) {
    if (Object.hasOwn(prepared, "value")) return prepared.value;
    let target = processes.get(prepared.key);
    const connection = await prepared.connection();
    const { ready, unhealthyProcess, missingUpstream } = await inspectSessionReadiness(target, {
      selection: prepared.selection, workdir: prepared.workdir, connection,
      changed: prepared.changed, refresh: prepared.refresh
    });
    if (!ready) {
      const { value: recovered } = await prepared.prepare(recovery => recoverSessionReadiness(target, {
        unhealthyProcess, missingUpstream,
        get key() { return recovery.key; }
      }, async () => {
        const configuration = recovery.configuration();
        async function ensureProcess() {
          return processOwner.acquirePrepared(await configuration.process());
        }
        const current = await ensureProcess();
        return ensureOpenCodeSession(current, configuration.session);
      }));
      if (recovered?.ok === false) return recovered;
      target = recovered;
    }
    const savedRun = prepared.observation.run;
    if (needsObservationRecovery(prepared.key, savedRun)) {
      await prepared.observation.write(async (run, commit) => {
        if (!needsObservationRecovery(prepared.key, run)) return;
        const threadId = normalizeNullableText(run.threadId) || target.upstreamSessionId;
        await recoverObservation(target, threadId, () => commit(writeRun => (
          recordStoppedObservation(prepared.key, run, threadId, writeRun)
        )));
      });
    }
    return {
      ok: true,
      thread: { id: target.upstreamSessionId },
      turn: openCodeTurnSnapshot(turns.get(prepared.key), target.upstreamSessionId),
      workdir: prepared.workdir
    };
  }

  async function inspectSessionReadiness(target, { selection, workdir, connection, refresh, changed }) {
    let ready = false;
    let unhealthyProcess = null;
    let missingUpstream = false;
    if (
      target?.upstream &&
      sameOpenCodeSelection(target.upstreamSelection, selection) &&
      target.workdir === workdir &&
      normalizeNullableText(target.selection?.catalogRevision) === normalizeNullableText(selection.catalogRevision) &&
      target.connectionFingerprint === connection.fingerprint &&
      target.canonicalUrl === connection.canonicalUrl &&
      target.endpointCode === connection.endpointCode
    ) {
      const observedProcess = processOwner.current;
      const observedServer = target.server;
      let healthy = false;
      const probe = AbortSignal.timeout(1_000);
      try {
        await target.server.client.health({ signal: probe });
        healthy = true;
        ready = Boolean(await target.server.client.readSession(target.upstreamSessionId));
      } catch (error) {
        if ((!healthy && probe.aborted) || (healthy && error?.statusCode !== 404)) {
          throw error;
        }
        if (!healthy) {
          unhealthyProcess = observedProcess;
        }
      }
      const current = await refresh();
      if (
        processes.get(current.key) !== target ||
        target.abortController.signal.aborted ||
        target.server !== observedServer ||
        target.workdir !== current.workdir ||
        !sameOpenCodeSelection(target.upstreamSelection, current.selection) ||
        normalizeNullableText(target.selection?.catalogRevision) !== normalizeNullableText(current.selection.catalogRevision)
      ) {
        throw changed();
      }
      missingUpstream = healthy && !ready;
    }
    return { ready, unhealthyProcess, missingUpstream };
  }

  async function recoverSessionReadiness(target, recovery, prepare) {
    if (recovery.unhealthyProcess && processOwner.current === recovery.unhealthyProcess) {
      await processOwner.stop("opencode-health-check-failed");
    }
    if (recovery.missingUpstream && processes.get(recovery.key) === target) {
      target.upstream = null;
    }
    return prepare();
  }

  // A saved active run whose observation already ended: lost, or stopped by the
  // previous server's shutdown. Recovery records it interrupted once native
  // work is idle; neither is the turn's own failure.
  function endedOnPreviousServer(run) {
    return Boolean(run?.observationError || run?.stoppedByShutdown === true);
  }

  function needsObservationRecovery(key, run) {
    return Boolean(run?.active && endedOnPreviousServer(run) && !monitors.has(key));
  }

  async function recordStoppedObservation(key, run, threadId, writeRun) {
    const stopped = {
      ...turns.get(key),
      ...run,
      id: normalizeNullableText(run.turnId),
      threadId,
      active: false,
      state: "interrupted",
      updatedAt: new Date().toISOString()
    };
    await writeRun(stopped, "interrupted", run.observationError);
    turns.set(key, stopped);
  }

  async function recoverObservation(target, threadId, commit) {
    if (threadId !== target.upstreamSessionId) return;
    const status = await target.server.client.sessionStatus(threadId, {
      signal: AbortSignal.timeout(OPENCODE_INTERRUPT_TIMEOUT_MS)
    });
    if (status?.type !== "idle") return;
    await commit();
  }

  async function interruptTurn(key, target, { threadId = "", writeRun } = {}) {
    const turn = turns.get(key);
    // Helpers can acquire the shared process before a main conversation exists.
    // Their cleanup is owned by closeSession, not a native main-turn interrupt.
    if (!target || (!normalizeNullableText(target.upstreamSessionId) && !turn?.active)) {
      return {
        interrupted: false,
        ok: true,
        thread: { id: threadId },
        turn: openCodeTurnSnapshot(turn)
      };
    }
    if (turn?.observationError) {
      await monitors.get(key);
      if (turn.active) {
        await processOwner.stopUnobservedSession(target, turn.threadId);
        turn.active = false;
        turn.state = "interrupted";
        await writeRun(turn, turn.state, turn.observationError);
      }
      return { ok: true, interrupted: true, thread: { id: turn.threadId }, turn: openCodeTurnSnapshot(turn) };
    }
    if (turn) {
      turn.interruptRequested = true;
    }
    const interrupted = Boolean(turn?.active);
    try {
      const confirmed = await target.server.client.interrupt(target.upstreamSessionId, {
        signal: AbortSignal.timeout(OPENCODE_INTERRUPT_TIMEOUT_MS)
      });
      if (confirmed !== true) {
        throw new AppError(502, "OpenCode did not confirm Stop. Try Stop again.", {
          code: "assistant_opencode_interrupt_unconfirmed", details: {}
        });
      }
    } catch (error) {
      if (turn) turn.interruptRequested = false;
      if (error?.name === "TimeoutError") {
        throw new AppError(504, "OpenCode did not confirm Stop within 5 seconds. Try Stop again.", {
          code: "assistant_opencode_interrupt_timeout", details: {}
        });
      }
      throw error;
    }
    if (turn?.active && turn.abortController) {
      turn.interruptAcknowledged = true;
      turn.abortController.abort();
      turn.admission?.resolve();
      await monitors.get(key);
    }
    return {
      interrupted,
      ok: true,
      thread: { id: target.upstreamSessionId },
      turn: openCodeTurnSnapshot(turn, target.upstreamSessionId)
    };
  }

  return Object.freeze({
    runPreparedRenewalTurn,
    sendPreparedMessage,
    inspectPreparedMessage,
    interruptPreparedTurn,
    sendMessage,
    reconcileSessions,
    reconcilePreparedSession,
    ensurePreparedSessionReadiness,
    inspectSessionReadiness,
    recoverSessionReadiness,
    needsObservationRecovery,
    recordStoppedObservation,
    recoverObservation,
    interruptTurn
  });
}
