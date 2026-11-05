// Observing a session's native turn until its final response: the turn's
// public snapshot, its failure, its event observation, the projection of its
// messages into the store, and the retained final-answer evidence.
import {
  waitForOpenCodeFinalResponse, openCodeLastAssistantResult, observeOpenCodeEvents, openCodeMessageRows, openCodeRowsForInput,
  recoverWithoutProjection
} from "./openCodeTurn.js";
import { openCodeAssistantMessageText as assistantMessageText } from "./openCodeClient.js";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeNullableText } from "./normalize.js";

/** A projection that keeps no native output identities. */
function noOutputId() {}

/** A turn's public state, or null before it has one. */
export function openCodeTurnSnapshot(turn = null, threadId = "") {
  const source = isRecord(turn) ? turn : {};
  const active = source.active === true;
  return active || normalizeNullableText(source.id)
    ? {
        active,
        error: normalizeNullableText(source.error),
        id: normalizeNullableText(source.id),
        phase: active && !source.observationError ? normalizeNullableText(source.phase) : "",
        startedAt: normalizeNullableText(source.startedAt),
        state: normalizeNullableText(source.state) || (active ? "active" : "completed"),
        status: source.observationError ? "observation_lost" : normalizeNullableText(source.state) || (active ? "active" : "completed"),
        threadId: normalizeNullableText(source.threadId || threadId),
        updatedAt: normalizeNullableText(source.updatedAt)
      }
    : null;
}

/** Whether a failure reads as a rejected or missing credential. */
function openCodeCredentialFailure(value = "") {
  const failure = normalizeNullableText(value);
  return (
    /\b(?:401|403)\b/u.test(failure) ||
    (
      /(?:api[-_\s]?key|authentication|authorization|credential|access[-_\s]?token|unauthori[sz]ed|forbidden)/iu.test(failure) &&
      /(?:denied|expired|failed|forbidden|incorrect|invalid|missing|rejected|revoked|unauthori[sz]ed)/iu.test(failure)
    )
  );
}

/** Whether a native error is the provider API's own failure. */
export function openCodeProviderApiFailure(error) {
  return normalizeNullableText(error?.name) === "APIError";
}

/** Observes a target's native events for a projection that reports their failure and close. */
export function observePreparedEvents(target, turn, abortController, signal, projection) {
  const observation = observeOpenCodeEvents(target.server.client, target.upstreamSessionId, {
    abortController, signal,
    eventStartedAt: turn ? turn.eventStartedAt : null,
    readError: projection.readError,
    onEvent: summary => projection.onEvent(summary, target)
  });
  void observation.completion.then(() => {
    projection.failure(observation.readFailure());
    projection.closed();
  });
  return {
    close: observation.close,
    readFailure: observation.readFailure,
    waitUntilReady(options) {
      const ready = observation.waitUntilReady(options);
      void ready.catch(projection.failure);
      return ready;
    }
  };
}

/** Projects a turn's native assistant messages and reasoning into the conversation store. */
export async function writeConversationProjection(sessionId, messages = null, {
  inputMessageId = "",
  streaming = false,
  captureFinalAssistantResult = false
} = {}, projection) {
  const { outputId: nativeOutputId = noOutputId } = projection;
  let failure = "";
  let finalAssistantResult = null;
  let providerApiFailure = false;
  const rows = (inputMessageId
    ? openCodeRowsForInput(messages, inputMessageId)
    : openCodeMessageRows(messages)).filter((message) => message?.type === "assistant");
  const finalNativeMessage = captureFinalAssistantResult && !streaming
    ? openCodeLastAssistantResult(rows, { readError: projection.readError }).message : null;
  for (const [index, message] of rows.entries()) {
    failure ||= projection.readError(message);
    providerApiFailure ||= openCodeProviderApiFailure(message.error);
    if (message.summary === true) continue;
    const assistantText = assistantMessageText(message);
    const messageId = assistantText ? projection.messageId(message.id, "assistant") : "";
    const outputId = assistantText ? nativeOutputId(message.id, "assistant") : "";
    const inFlight = streaming && index === rows.length - 1;
    const reasoning = (message.content || []).filter((part) => part.type === "reasoning" && normalizeNullableText(part.text))
      .map((part) => ({
        messageId: message.id,
        partId: part.id,
        text: part.text,
        createdAt: message.time?.created,
        complete: Boolean(part.time?.end)
      }));
    await projection.reasoning(reasoning, {
      complete: !inFlight || Boolean(message.time?.completed || message.finish),
      flush: !streaming || Boolean(assistantText && !inFlight)
    });
    if (streaming && assistantText && !inFlight) {
      // A completed round persists as soon as the next one starts, so
      // superseded narration never evaporates from the transcript.
      const turn = await projection.store.writeConversationAssistantMessage(sessionId, {
        messageId,
        ...(outputId ? { outputId } : {}),
        text: assistantText
      });
      projection.store.completeConversationStreamMessage(sessionId, messageId);
      await projection.publishTurn(turn);
      continue;
    }
    if (streaming && assistantText && inFlight) {
      const conversationStream = projection.store.updateConversationStream(sessionId, {
        turnId: inputMessageId,
        messageId,
        ...(outputId ? { outputId } : {}),
        text: assistantText
      });
      if (conversationStream) {
        await projection.publishStream(conversationStream);
      }
      continue;
    }
    if (assistantText && !streaming) {
      const turn = await projection.store.writeConversationAssistantMessage(sessionId, {
        messageId,
        ...(outputId ? { outputId } : {}),
        text: assistantText
      });
      projection.store.completeConversationStreamMessage(sessionId, messageId);
      await projection.publishTurn(turn);
      if (message === finalNativeMessage && !projection.readError(message) &&
          (message.time?.completed || message.finish) && turn) {
        finalAssistantResult = { inputMessageId: normalizeNullableText(inputMessageId), itemId: normalizeNullableText(message.id),
          text: assistantText, conversationTurn: turn };
      }
    }
  }
  return { failure, providerApiFailure, ...(captureFinalAssistantResult ? { finalAssistantResult } : {}) };
}

/**
 * Starts and retires the monitor that observes a session's native turn, and
 * reads the final-answer evidence it retains.
 * @param {{
 *   processes: Map<string, object>,
 *   monitors: Map<string, Promise<object>>,
 *   turns: Map<string, object>,
 *   processOwner: import("./openCodeProcessOwner.js").OpenCodeProcessOwner
 * }} options
 */
export function createOpenCodeTurnMonitor({ processes, monitors, turns, processOwner }) {
  // Evidence belongs to the exact retained native turn. This read never creates,
  // observes, resumes or projects a native conversation.
  function readFinalAssistantResult(key, threadId = "", turnId = "") {
    const turn = turns.get(key);
    const result = turn?.finalAssistantResult;
    const target = turn?.finalAssistantResultTarget;
    if (!target || processes.get(key) !== target || target.abortController.signal.aborted ||
        !turn.finalAssistantResultProcess || processOwner.current !== turn.finalAssistantResultProcess ||
        target.upstreamSessionId !== turn.threadId) return null;
    if (!normalizeNullableText(threadId) || !normalizeNullableText(turnId) || !result || turn.active || turn.state !== "completed" ||
        turn.error || turn.observationError || turn.interruptRequested || turn.interruptAcknowledged ||
        turn.threadId !== normalizeNullableText(threadId) || turn.id !== normalizeNullableText(turnId) ||
        result.threadId !== normalizeNullableText(threadId) || result.turnId !== normalizeNullableText(turnId) ||
        result.inputMessageId !== normalizeNullableText(turn.inputMessageId) || !result.conversationTurn) return null;
    return structuredClone(result);
  }

  function beginMessageMonitor(key, target, admitted, options, projection) {
    const start = () => {
      target = { ...target };
      const existing = monitors.get(key);
      if (existing) {
        return existing;
      }
      const metadata = projection.prepare(admitted, options);
      const eventStartedAt = Number(admitted.eventStartedAt) || Date.now();
      const startedAt = normalizeNullableText(admitted.startedAt) || new Date(eventStartedAt).toISOString();
      const turn = {
        abortController: new AbortController(),
        admission: options.admission,
        active: true,
        error: "",
        eventStartedAt,
        id: normalizeNullableText(admitted.id),
        inputMessageId: normalizeNullableText(admitted.id),
        startedAt,
        state: options.admission ? "starting" : "active",
        ...metadata.fields,
        threadId: target.upstreamSessionId,
        updatedAt: startedAt
      };
      const monitor = beginMonitor(key, target, turn, projection.create(target, turn, metadata, options));
      void monitor.catch(error => projection.onError(error));
      return monitor;
    };
    // readable-check: allow method-probe - optional operation: a monitor that runs inside its request's context supplies runInContext
    if (typeof projection.runInContext !== "function") return start();
    let monitor, startFailure;
    // Context entry invokes this callback synchronously. Do not return the
    // monitor to an async scope wrapper: retain its identity and error owner.
    const scope = projection.runInContext(() => {
      try { monitor = start(); }
      catch (error) { startFailure = { error }; }
    });
    void Promise.resolve(scope).catch(error => projection.onError(error));
    if (startFailure) throw startFailure.error;
    return monitor;
  }

  // A turn's failure and whether it is a credential failure. A removed
  // connection's models are gone from its reloaded directory.
  function turnFailure(failure) {
    const providerId = /\bModel not found: ([^/\s]+)\//u.exec(failure)?.[1];
    if (providerId && processOwner.current && !processOwner.current.connections.has(providerId)) {
      return { failure: `${providerId} isn't connected. Connect it again, then send your message again.`, credentialFailure: true };
    }
    return { failure, credentialFailure: openCodeCredentialFailure(failure) };
  }

  function beginMonitor(key, target, turn, {
    observe, observation, eventReady, readiness, finalResponse,
    writeRun, projectMessages, completeResult, onRetired
  }) {
    delete turn.finalAssistantResult;
    delete turn.finalAssistantResultTarget;
    delete turn.finalAssistantResultProcess;
    const registeredTarget = processes.get(key);
    const finalAssistantResultTarget = registeredTarget &&
      registeredTarget.abortController === target.abortController &&
      registeredTarget.server === target.server &&
      registeredTarget.upstreamSessionId === target.upstreamSessionId ? registeredTarget : null;
    const finalAssistantResultProcess = finalAssistantResultTarget ? processOwner.current : null;
    turns.set(key, turn);
    const releaseDirectory = processOwner.holdDirectory(target.workdir);
    const signal = AbortSignal.any([target.abortController.signal, turn.abortController.signal]);
    const monitor = Promise.resolve().then(async () => {
      const events = observation
        ? observePreparedEvents(target, turn, turn.abortController, signal, observation())
        : observe(turn, signal);
      if (eventReady) {
        void events.waitUntilReady(readiness).then(eventReady.resolve, eventReady.reject);
      }
      let finalState = "completed";
      let failure = "";
      let finalAssistantResult = null;
      let credentialFailure = false;
      let providerApiFailure = false;
      try {
        await turn.admission?.promise;
        signal.throwIfAborted();
        turn.state = "active";
        await writeRun(turn, "active");
        for (;;) {
          const completion = await waitForOpenCodeFinalResponse(
            target.server.client,
            target.upstreamSessionId,
            turn,
            {
              ...finalResponse,
              // Preserve the reasoning-only completion before the native recovery
              // input replaces the projection boundary. Replayed writes are no-ops.
              beforeRecovery: async completion => {
                await projectMessages(completion.messages, { inputMessageId: completion.inputMessageId });
                const { beforeRecovery = recoverWithoutProjection } = finalResponse;
                await beforeRecovery(completion);
              },
              onMessages: async (messages, inputMessageId) => {
                const latest = openCodeLastAssistantResult(messages, { readError: finalResponse.readError }).message;
                const phase = latest?.summary === true && Number(latest.time?.created) >= turn.eventStartedAt &&
                  !latest.time?.completed && !latest.finish && !latest.error ? "compacting" : "";
                if (turn.active && !signal.aborted && normalizeNullableText(turn.phase) !== phase) {
                  turn.phase = phase;
                  turn.updatedAt = new Date().toISOString();
                  await writeRun(turn, turn.state);
                }
                return projectMessages(messages, { inputMessageId, streaming: true });
              },
              readFailure: events.readFailure,
              signal
            }
          );
          const admission = turn.admission;
          await admission?.promise;
          signal.throwIfAborted();
          if (admission !== turn.admission || completion.inputMessageId !== normalizeNullableText(turn.inputMessageId)) {
            continue;
          }
          const projection = await projectMessages(completion.messages, {
            inputMessageId: completion.inputMessageId,
            captureFinalAssistantResult: true
          });
          await turn.admission?.promise;
          signal.throwIfAborted();
          if (admission !== turn.admission || completion.inputMessageId !== normalizeNullableText(turn.inputMessageId)) {
            continue;
          }
          failure = projection.failure || normalizeNullableText(events.readFailure()?.message);
          providerApiFailure = projection.providerApiFailure || openCodeProviderApiFailure(events.readFailure());
          if (!failure && !turn.interruptRequested && !normalizeNullableText(completion.result?.text)) {
            failure = "OpenCode finished without a user-facing final response. Please send your message again.";
            finalState = "failed";
          } else if (failure) {
            ({ failure, credentialFailure } = turnFailure(failure));
            finalState = "failed";
          } else if (turn.interruptRequested) {
            finalState = "interrupted";
          }
          const published = projection.finalAssistantResult;
          if (finalState === "completed" && !failure && published &&
              published.inputMessageId === completion.inputMessageId &&
              published.itemId === completion.result?.turnId &&
              normalizeNullableText(published.text) === normalizeNullableText(completion.result?.text)) {
            finalAssistantResult = { ...published, threadId: turn.threadId, turnId: turn.id };
          }
          break;
        }
      } catch (error) {
        if (turn.interruptAcknowledged) {
          finalState = "interrupted";
        } else {
          const cause = signal.aborted ? signal.reason : error;
          ({ failure, credentialFailure } = turnFailure(normalizeNullableText(cause?.message) || "OpenCode turn failed."));
          providerApiFailure = openCodeProviderApiFailure(cause);
          finalState = target.abortController.signal.aborted
            ? "cancelled"
            : "failed";
          if (!target.abortController.signal.aborted) {
            turn.observationError = failure;
            try {
              await writeRun(turn, turn.state, failure);
            } catch {
              // A failed store must not prevent stopping native work.
            }
            try {
              await processOwner.stopUnobservedSession(target, turn.threadId);
            } catch (stopError) {
              failure = `${failure} ${stopError.message}`;
              finalState = "active";
            }
          }
        }
      } finally {
        // The end of a turn the server's shutdown stopped belongs to the next
        // server: its saved run stays active and carries the shutdown's mark,
        // so that server's recovery records the turn interrupted and runs the
        // host's checkpoint. Run here, that checkpoint (a Git snapshot, say)
        // would hold the host's bounded shutdown for as long as it takes. A
        // user's Stop ends its turn as interrupted here.
        const nextServerEnds = turn.stoppedByShutdown === true && finalState !== "active";
        // Claim retirement before awaited cleanup/checkpointing. A new Send
        // joins this monitor's cleanup instead of steering an unobserved turn.
        turn.active = finalState === "active";
        await events.close();
        if (!nextServerEnds && (credentialFailure || finalState === "failed")) {
          failure = await completeResult(turn, { credentialFailure, providerApiFailure, finalState, failure });
        }
        turn.error = failure;
        turn.state = finalState;
        turn.finalAssistantResult = finalState === "completed" && !failure ? finalAssistantResult : null;
        turn.finalAssistantResultTarget = turn.finalAssistantResult ? finalAssistantResultTarget : null;
        turn.finalAssistantResultProcess = turn.finalAssistantResult ? finalAssistantResultProcess : null;
        turn.updatedAt = new Date().toISOString();
        await (nextServerEnds ? writeRun(turn, "active", "") : writeRun(turn, finalState, failure)).catch(() => null);
      }
      return openCodeTurnSnapshot(turn, target.upstreamSessionId);
    }).finally(() => {
      if (monitors.get(key) === monitor) {
        monitors.delete(key);
      }
      releaseDirectory();
      onRetired();
    });
    monitors.set(key, monitor);
    return monitor;
  }

  return Object.freeze({
    beginMessageMonitor,
    beginMonitor,
    readFinalAssistantResult
  });
}

/** @typedef {ReturnType<typeof createOpenCodeTurnMonitor>} OpenCodeTurnMonitor */
