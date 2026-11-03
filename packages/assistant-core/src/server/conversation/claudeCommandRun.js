/**
 * Runs an application command on a Claude conversation: its dispatch,
 * steering, cancellation and settlement. A runtime binding runs it on the one
 * entry it selected; otherwise each dispatch acquires its entry.
 * @param {{
 *   bound: boolean,
 *   preparation: import("./claudeTurn.js").ClaudeConversationPreparation,
 *   send: (entry: import("./claudeTurn.js").ClaudeConversationEntry, input?: Record<string, any>, options?: Record<string, any>) => Promise<Record<string, any>>,
 *   interrupt: (entry: import("./claudeTurn.js").ClaudeConversationEntry) => Promise<Record<string, any>>
 * }} options
 */
export function createClaudeCommandRun({ bound, preparation, send, interrupt }) {
  async function cancel(control, { context, acquire, reportFailure, entry }) {
    if (bound) {
      await entry.nativeTurn.stopProcess("Work stopped.");
      return;
    }
    try {
      const value = await interrupt(await acquire(context || control.current?.context));
      if (control.cleanupFailure) {
        await reportFailure(control.cleanupFailure, { recovered: true });
        control.cleanupFailure = null;
      }
      return value;
    } catch (error) {
      error.cleanupFailed = true;
      control.cleanupFailure = error;
      control.current?.failure.reject(error);
      await reportFailure(error);
      throw error;
    }
  }

  async function dispatch(control, command, { acquire, entry: selectedEntry, dispatch: nativeDispatch }) {
    if (bound) {
      await send(selectedEntry, command.input, { command: nativeDispatch });
      return;
    }
    command.signal.throwIfAborted();
    const entry = await acquire(command.context);
    const active = control.current;
    const applicationCommand = active && (active.tools || active.finishIfCurrent) ? { active, accept: command.accept } : null;
    if (applicationCommand) {
      if (entry.disposed || entry.command && entry.command !== active) throw new Error("This Claude conversation is closed or already working.");
      if (active.entry && active.entry !== entry) throw new Error("Claude's application tools belong to another native conversation.");
      active.entry = entry;
      entry.command = active;
      entry.toolSchemas = active.tools?.schemas || [];
    }
    const value = await send(entry, { ...command.input.nativeMessage, signal: command.input.signal, onPromptSending: command.beforeDispatch,
      onNativeReceipt: command.onNativeReceipt, onReceiptPersisted: command.onReceiptPersisted, deliveryTiming: command.deliveryTiming },
    { applicationCommand });
    const completion = value.conversationTurn ? entry.completion?.promise : null;
    const delivered = { value, completion };
    if (!applicationCommand && value.delivered === true && value.conversationTurn) {
      if (control.current) control.current.delivery = delivered;
      await command.accept({ nativeResult: { value }, conversationTurn: value.conversationTurn, nativeTurnId: value.turn?.id });
    }
    return delivered;
  }

  function steer(control, command, options) {
    if (!bound) return dispatch(control, command, options).then(delivered => ({ value: delivered.value }));
    if (!control.current?.steer || !control.current.entry.nativeTurn.read().active) throw new Error("Claude has no active turn to steer.");
    return control.current.steer(command);
  }

  async function run(control, command, { acquire, reportFailure, entry: selectedEntry, maximumOutput, maximumToolCalls = 32, timeoutMs } = {}) {
    if (control.disposed || control.current) throw new Error("This Claude conversation is closed or already working.");
    const { configuration, context, input, tools, signal, beforeDispatch, accept, onMessage, onEvent, onNativeToolUse } = command;
    const completion = Promise.withResolvers();
    completion.promise.catch(() => {});
    const active = { completion, onMessage, onEvent, onNativeToolUse, signal, tools, admitted: false, nativeTools: new Map(),
      messageId: input.messageId, goal: input.goal, nativeToolCount: 0, toolWork: new Set(), maximumToolCalls,
      context, finishIfCurrent: command.finishIfCurrent, failure: Promise.withResolvers() };
    let failure;
    active.failure.promise.catch(error => { failure = error; });
    control.current = active;
    const ready = Promise.withResolvers();
    ready.promise.catch(() => {});
    active.steer = async ({ input, beforeDispatch, accept, onNativeReceipt, onReceiptPersisted, deliveryTiming }) => {
      await ready.promise;
      const nativeDispatch = { active, signal, beforeDispatch, accept, onNativeReceipt, onReceiptPersisted, deliveryTiming,
        timeoutMs, steering: true, attempted: false, admitted: false };
      try { await dispatch(control, { input, context, signal }, { acquire, entry, dispatch: nativeDispatch }); }
      catch (error) {
        if (nativeDispatch.attempted && !nativeDispatch.admitted && error.delivery !== "not-sent") error.delivery = "uncertain";
        if (nativeDispatch.attempted) completion.reject(error);
        throw error;
      }
    };
    const nativeDispatch = { active, signal, beforeDispatch, accept, onNativeReceipt: command.onNativeReceipt,
      onReceiptPersisted: command.onReceiptPersisted, deliveryTiming: command.deliveryTiming, timeoutMs, maximumOutput, attempted: false, admitted: false };
    let entry;
    let cancellation;
    let problem;
    let delivered;
    function abort() {
      if (cancellation) return;
      if (bound) {
        cancellation = entry.nativeTurn.cancel(entry.process?.client, () => entry.nativeTurn.stopProcess("Work stopped."));
        cancellation.then(() => completion.reject(signal.reason), error => completion.reject(error));
      } else {
        cancellation = cancel(control, { context, acquire, reportFailure }).then(() => { throw signal.reason; });
        cancellation.catch(active.failure.reject);
      }
    }
    try {
      if (bound) {
        entry = selectedEntry;
        if (entry.disposed || entry.command) throw new Error("This Claude conversation is closed or already working.");
        active.entry = entry;
        entry.command = active;
        entry.completion = completion;
        entry.toolSchemas = tools?.schemas || [];
        active.delivery = { completion: completion.promise };
        nativeDispatch.prepared = await preparation.configuration(entry, { configuration, context, signal, tools });
      }
      signal.addEventListener("abort", abort, { once: true });
      let dispatchFailure;
      try {
        delivered = await dispatch(control, command, { acquire, entry, dispatch: nativeDispatch });
        if (bound) ready.resolve();
      } catch (error) { dispatchFailure = error; }
      for (;;) {
        const settling = active.delivery;
        let result;
        problem = dispatchFailure || failure;
        if (!problem && settling?.completion) {
          try { result = await Promise.race([settling.completion, active.failure.promise]); }
          catch (error) { problem = error; }
        }
        if (command.finishIfCurrent && !await command.finishIfCurrent(() => active.delivery === settling)) continue;
        if (!problem && typeof result === "function") {
          try { result = await result(); }
          catch (error) { problem = error; }
        }
        problem = dispatchFailure || failure || problem;
        if (!problem && settling?.completion && (bound ? result.status !== "completed" : !result.ok)) {
          // readable-check: allow patched-error - data: status is the native turn's state, not an HTTP status
          problem = Object.assign(new Error(result.error || (bound ? "Claude interrupted this answer." : `Claude turn ${result.status}.`)), { status: result.status });
        }
        break;
      }
    } catch (error) { problem = error; }
    ready.reject(problem || new Error("Claude work ended."));
    signal.removeEventListener("abort", abort);
    if (bound) {
      try {
        if (problem || signal.aborted) await (cancellation || entry.nativeTurn.stopProcess(problem?.message || "Work stopped."));
      } catch (error) {
        if (problem && error !== problem) error.cause ||= problem;
        problem = error;
      }
      finally {
        await Promise.allSettled([...active.toolWork]);
        if (entry?.command === active) entry.command = null;
      }
    } else {
      await cancellation?.catch(() => {});
      if (active.entry) {
        try {
          // A failed Stop already retained custody for the caller's retry.
          // Do not race that retry with another implicit cleanup attempt.
          if ((problem || signal.aborted) && !problem?.cleanupFailed) {
            await active.entry.nativeTurn.stopProcess(problem?.message || "Work stopped.");
          }
        } catch (error) {
          if (problem && error !== problem) error.cause ||= problem;
          problem = error;
        }
        finally {
          await Promise.allSettled([...active.toolWork]);
          if (active.entry.command === active) active.entry.command = null;
        }
      }
    }
    if (control.current === active) control.current = null;
    if (problem) {
      if (bound && nativeDispatch.attempted && !nativeDispatch.admitted && problem.delivery !== "not-sent") problem.delivery = "uncertain";
      throw problem;
    }
    if (!bound) return { value: delivered.value };
  }

  return Object.freeze({
    run,
    steer,
    cancel
  });
}
