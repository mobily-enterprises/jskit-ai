import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import {
  OPENCODE_INTERRUPT_TIMEOUT_MS, openCodeLastAssistantResult, openCodeMessageRows, openCodeRowsForInput, readOpenCodeMessagesUntil,
  openCodePersistentConversationMessages, openCodeStructuredOutput, waitForOpenCodeMessages, steerOpenCodeTurn, dispatchOpenCodeTurn,
  observeOpenCodeTurnCompletion
} from "./openCodeTurn.js";
import { openCodeServerForDirectory } from "./openCodeNativeSession.js";
import { observePreparedEvents } from "./openCodeTurnMonitor.js";
import { normalizeNullableText } from "./normalize.js";

/** The target, with its server bound to a prepared conversation's own directory when it has one. */
function scopedTarget(target, prepared) {
  const workdir = prepared.workdir;
  return workdir ? { ...target, server: openCodeServerForDirectory(target.server, workdir), workdir } : target;
}

/**
 * Temporary native conversations beside a session's main one: their creation,
 * selection, turns, reads, waits, stops and deletion.
 * @param {{
 *   processes: Map<string, object>,
 *   temporaryConversations: Map<string, object>,
 *   processOwner: import("./openCodeProcessOwner.js").OpenCodeProcessOwner
 * }} options
 */
export function createOpenCodeTemporaryConversations({ processes, temporaryConversations, processOwner }) {
  async function createPreparedConversation(prepared) {
    const target = scopedTarget(await processOwner.acquirePrepared(prepared.process), prepared);
    const conversation = await createConversation(prepared.key, target, prepared.selection(), prepared.executionProfile);
    return { conversationId: conversation.id, ephemeral: prepared.ephemeral, ok: true, status: "ready" };
  }

  async function selectPreparedConversation(prepared) {
    const target = scopedTarget(await processOwner.acquirePrepared(prepared.process), prepared);
    const selection = prepared.selection();
    const conversationId = selection.conversationId;
    const previous = conversationId ? temporaryConversations.get(`${prepared.key}\0${conversationId}`) : null;
    if (selection.scoped && previous && JSON.stringify(previous.executionProfile || null) !== JSON.stringify(prepared.executionProfile)) {
      throw selection.profileChanged();
    }
    if (!conversationId && !selection.createIfMissing) throw selection.identityRequired();
    if (!previous?.active) await processOwner.currentDirectory(target.workdir);
    const selected = await selectConversation(prepared.key, target, conversationId, selection.input, selection.registration);
    return { ...selected, executionProfile: prepared.executionProfile, target };
  }

  async function existingPreparedConversation(prepared) {
    return { conversationId: prepared.conversationId, ...await existingConversation(
      prepared.key, prepared.conversationId, prepared.persistent,
      async () => processOwner.acquirePrepared(await prepared.process())
    ) };
  }

  async function runPreparedConversationTurn(prepared) {
    const selected = await selectPreparedConversation(prepared);
    const turn = prepared.turn(selected);
    return runConversationTurn(selected.target, selected.conversationId, selected.tracked,
      turn.input, turn.options).catch(prepared.failure);
  }

  async function readPreparedConversation(prepared, input) {
    const { conversationId, target, tracked } = await existingPreparedConversation(prepared);
    if (!target) throw prepared.readUnavailable();
    if (!input.persistent) return prepared.projectResult(
      await readConversation(target, conversationId, tracked, {}, prepared.readError), tracked?.executionProfile);
    return readPersistentConversation(target, conversationId, tracked, prepared.messages).catch(prepared.failure);
  }

  async function waitPreparedConversationTurn(prepared, input) {
    const { conversationId, target, tracked } = await existingPreparedConversation(prepared);
    if (!target) throw prepared.readUnavailable();
    return waitForConversationTurn(target, conversationId, tracked, input, prepared.readError);
  }

  async function stopPreparedConversation(prepared, input) {
    const { conversationId, target, tracked } = await existingPreparedConversation(prepared);
    return stopConversation(target, conversationId, tracked, { persistent: input.persistent }).catch(prepared.failure);
  }

  async function deletePreparedConversation(prepared, input) {
    const { conversationId, key, target, tracked } = await existingPreparedConversation(prepared);
    const result = await deleteConversation(key, target, conversationId, tracked, {
      allowMissing: Boolean(input.persistent || prepared.scoped), onRemoved: prepared.onRemoved
    });
    if (!result.deleted) return result;
    const cleanup = prepared.cleanupAfterDelete;
    let providerExit = null;
    if (cleanup) {
      providerExit = await processOwner.closeSession(cleanup.sessionId, cleanup.options, cleanup.application);
      // The result carries the deleted scope's exit proof. Only renewal releases
      // a kept proof, and a scope is never renewed, so the kept one is dropped.
      processOwner.releaseProcessExitProof(cleanup.sessionId);
    }
    return { conversationId, deleted: true, ok: providerExit?.ok !== false,
      ...(providerExit ? { providerExit } : {}) };
  }

  async function createConversation(key, target, input, executionProfile = null) {
    await target.server.client.prepareDirectory({ signal: target.abortController?.signal });
    const conversation = await target.server.client.createSession({
      agent: input.agent,
      location: { directory: target.workdir },
      model: input.model
    });
    temporaryConversations.set(`${key}\0${conversation.id}`, {
      active: false,
      executionProfile,
      target
    });
    return conversation;
  }

  async function selectConversation(parentKey, target, conversationId, input, registration) {
    await target.server.client.prepareDirectory({ signal: target.abortController?.signal });
    if (!conversationId) {
      const created = await target.server.client.createSession({
        agent: input.agent,
        location: { directory: target.workdir },
        model: input.model
      });
      conversationId = created.id;
    } else {
      await target.server.client.switchModel(conversationId, input.model);
      await target.server.client.switchAgent(conversationId, input.agent);
    }
    const key = `${parentKey}\0${conversationId}`;
    const tracked = temporaryConversations.get(key) || { active: false, target };
    tracked.target = target;
    tracked.executionProfile = registration.executionProfile;
    tracked.conversationId = conversationId;
    tracked.promptContext = registration.promptContext;
    temporaryConversations.set(key, tracked);
    await registration.onSelected();
    return { conversationId, key, tracked };
  }

  async function existingConversation(parentKey, conversationId, persistent, prepareTarget) {
    const key = `${parentKey}\0${conversationId}`;
    let tracked = temporaryConversations.get(key) || null;
    let target = tracked?.target || processes.get(parentKey) || null;
    if (persistent && (!target || target.abortController.signal.aborted)) {
      temporaryConversations.delete(key);
      tracked = null;
      target = await prepareTarget();
    }
    return { key, tracked, target };
  }

  async function readConversation(target = {}, conversationId = "", tracked = null, options = {}, readError) {
    const messages = await readOpenCodeMessagesUntil(target.server.client, conversationId,
      rows => rows.some(row => row?.type === "assistant"), options);
    const result = openCodeLastAssistantResult(messages, { readError });
    return {
      conversationId,
      error: normalizeNullableText(tracked?.error?.message) || result.error,
      ok: !tracked?.error && !result.error,
      runId: tracked?.inputMessageId || "",
      status: tracked?.active ? "inProgress"
        : tracked?.interrupted ? "interrupted"
        : tracked?.error || result.error ? "failed" : "completed",
      text: result.text
    };
  }

  async function readPersistentConversation(target, conversationId, tracked, projection) {
    const { readError } = projection;
    let status = await target.server.client.sessionStatus(conversationId);
    if (!tracked && status.type !== "idle") {
      await processOwner.stopUnobservedSession(target, conversationId);
      status = { type: "idle" };
    }
    const rows = openCodeMessageRows(await target.server.client.messages(conversationId));
    const result = openCodeLastAssistantResult(rows, { readError });
    const messages = openCodePersistentConversationMessages(rows, projection.messageId);
    const runId = tracked?.inputMessageId || [...rows].reverse().find((row) => row.type === "user")?.id || "";
    // The application marks the run a previous server's shutdown stopped: that
    // run's native abort is the shutdown's interruption, not its failure, and
    // recording it lets the application make the checkpoint it still owes.
    const shutdownStop = projection.stoppedByShutdown;
    const stoppedByShutdown = !tracked && Boolean(runId) && shutdownStop?.runId === runId;
    let conversationStatus = "completed";
    if (status.type !== "idle" || tracked?.active) conversationStatus = "inProgress";
    else if (tracked?.interrupted || stoppedByShutdown) conversationStatus = "interrupted";
    else if (tracked?.error || result.error) conversationStatus = "failed";
    if (stoppedByShutdown) await shutdownStop.ended();
    return {
      conversationId,
      ok: true,
      messages,
      text: result.text,
      admitted: Boolean(projection.inputMessageId && rows.some((row) => row.id === projection.inputMessageId)),
      error: stoppedByShutdown ? "" : normalizeNullableText(tracked?.error?.message) || result.error,
      runId,
      status: conversationStatus
    };
  }

  async function waitForConversationTurn(target, conversationId, tracked, input = {}, readError) {
    if (tracked?.completion && (tracked.executionProfile || !input.timeoutMs)) {
      return tracked.completion;
    }
    await waitForOpenCodeMessages(target.server.client, conversationId, tracked?.inputMessageId || "", {
      signal: input.timeoutMs ? AbortSignal.timeout(Number(input.timeoutMs)) : undefined,
      readError
    });
    return readConversation(target, conversationId, null, {}, readError);
  }

  async function runConversationTurn(target, conversationId, tracked, input, options) {
    if (tracked.active && tracked.error) {
      await processOwner.stopUnobservedSession(tracked.target, conversationId);
      tracked.active = false;
    }
    if (tracked.active && input.steer === true) {
      const messageId = input.steeringId;
      await steerOpenCodeTurn(target.server.client, conversationId, tracked, {
        agent: input.agent,
        id: messageId,
        model: input.model,
        prompt: input.prompt,
        attachments: input.attachments
      }, { signal: AbortSignal.any([target.abortController.signal, tracked.abortController.signal]) });
      return {
        conversationId,
        ok: true,
        runId: tracked.inputMessageId,
        status: "inProgress",
        deliveryMode: "steer"
      };
    }
    // A new native turn starts only on its directory's current credentials.
    while (!tracked.active && !processOwner.directoryCurrent(target.workdir)) await processOwner.waitForDirectory(target.workdir);
    if (tracked.active) {
      throw new AppError(409, "This conversation is still working.", {
        code: "assistant_opencode_conversation_busy", details: {}
      });
    }
    tracked.active = true;
    const releaseDirectory = processOwner.holdDirectory(target.workdir);
    tracked.error = null;
    tracked.interrupted = false;
    const turnAbort = new AbortController();
    tracked.abortController = turnAbort;
    const inputMessageId = input.id;
    const observedTarget = { ...target, upstreamSessionId: conversationId };
    const signal = AbortSignal.any([target.abortController.signal, turnAbort.signal, ...(options.signal ? [options.signal] : [])]);
    const events = options.observation
      ? observePreparedEvents(observedTarget, null, turnAbort, signal, options.observation())
      : options.observe(observedTarget, turnAbort, signal);
    let admitted;
    try {
      admitted = await dispatchOpenCodeTurn(tracked, {
        get agent() { return input.agent; },
        id: inputMessageId,
        get model() { return input.model; },
        get prompt() { return input.prompt; },
        get attachments() { return input.attachments; }
      }, {
        get client() { return target.server.client; },
        get conversationId() { return conversationId; },
        events, signal,
        readiness: options.readiness,
        beforeDispatch: options.beforeDispatch
      });
    } catch (error) {
      try {
        await events.close();
        tracked.error = error;
        if (tracked.promptAttempted) await processOwner.stopUnobservedSession(observedTarget, conversationId);
        tracked.active = false;
      } finally {
        releaseDirectory();
      }
      throw error;
    }
    tracked.inputMessageId = normalizeNullableText(admitted.id);
    tracked.completion = (async () => {
      const completion = options.completion;
      const onMessages = completion.onMessages;
      const result = await observeOpenCodeTurnCompletion(processOwner, observedTarget, conversationId, tracked, {
        ...completion, events, signal,
        ...(onMessages ? {
          onMessages: (messages, inputMessageId) => onMessages(
            openCodePersistentConversationMessages(openCodeRowsForInput(messages, inputMessageId), completion.messageId),
            inputMessageId
          )
        } : {}),
        projectResult: async () => {
          const result = completion.projectResult(
            await readConversation(target, conversationId, null, { signal }, completion.readError)
          );
          return { ...result, text: input.outputSchema ? openCodeStructuredOutput(result.text) : result.text };
        }
      });
      if (result.interrupted) {
        return { conversationId, ok: true, runId: tracked.inputMessageId, status: "interrupted", text: "" };
      }
      return result;
    })();
    void tracked.completion.then(releaseDirectory, releaseDirectory);
    // Keep a failed admitted turn observable to the client's conversation reads.
    void tracked.completion.catch((error) => {
      if (tracked.abortController === turnAbort) tracked.error = error;
    });
    options.onCompletion(tracked.completion);
    return options.waitForCompletion ? tracked.completion : {
      conversationId,
      ok: true,
      runId: tracked.inputMessageId,
      status: "inProgress",
      threadId: conversationId,
      turnId: tracked.inputMessageId
    };
  }

  async function stopConversation(target, conversationId, tracked, { persistent = false } = {}) {
    if (!target) {
      return { conversationId, ok: true, stopped: false };
    }
    try {
      if (tracked?.active && tracked.error) {
        await processOwner.stopUnobservedSession(target, conversationId);
      } else {
        const confirmed = await target.server.client.interrupt(conversationId, {
          signal: AbortSignal.timeout(OPENCODE_INTERRUPT_TIMEOUT_MS)
        });
        const status = persistent ? await target.server.client.sessionStatus(conversationId, {
          signal: AbortSignal.timeout(OPENCODE_INTERRUPT_TIMEOUT_MS)
        }) : null;
        if (confirmed !== true || status && status.type !== "idle") {
          throw new AppError(502, "OpenCode did not confirm Stop. Try Stop again.", {
            code: "assistant_opencode_interrupt_unconfirmed", details: {}
          });
        }
      }
    } catch (error) {
      if (persistent && error.statusCode === 404) return { conversationId, ok: true, stopped: true };
      if (error?.name === "TimeoutError") {
        throw new AppError(504, "OpenCode did not confirm Stop within 5 seconds. Try Stop again.", {
          code: "assistant_opencode_interrupt_timeout", details: {}
        });
      }
      throw error;
    }
    if (tracked) {
      tracked.interrupted = true;
      tracked.abortController?.abort();
      await tracked.completion?.catch(() => null);
      tracked.active = false;
    }
    return { conversationId, ok: true, stopped: true };
  }

  async function deleteConversation(key, target, conversationId, tracked, { allowMissing, onRemoved }) {
    if (!target) {
      temporaryConversations.delete(key);
      await onRemoved();
      return { conversationId, deleted: false, ok: true };
    }
    try {
      await target.server.client.deleteSession(conversationId);
    } catch (error) {
      if (!allowMissing || error.statusCode !== 404) throw error;
    }
    if (tracked) {
      tracked.interrupted = true;
      tracked.abortController?.abort();
      await tracked.completion?.catch(() => null);
    }
    temporaryConversations.delete(key);
    await onRemoved();
    return { conversationId, deleted: true, ok: true };
  }

  function hasActiveTemporaryConversation(sessionId) {
    return [...temporaryConversations.values()].some((entry) => (
      !entry.reasoningSummary && entry.active === true && entry.target?.sessionId === sessionId
    ));
  }

  return Object.freeze({
    createPreparedConversation,
    selectPreparedConversation,
    existingPreparedConversation,
    runPreparedConversationTurn,
    readPreparedConversation,
    waitPreparedConversationTurn,
    stopPreparedConversation,
    deletePreparedConversation,
    createConversation,
    selectConversation,
    existingConversation,
    runConversationTurn,
    readConversation,
    readPersistentConversation,
    waitForConversationTurn,
    stopConversation,
    deleteConversation,
    hasActiveTemporaryConversation
  });
}
