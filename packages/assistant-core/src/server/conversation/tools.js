import { isDeepStrictEqual } from "node:util";
import { DEFAULT_MAX_TOOL_ARGUMENT_BYTES, DEFAULT_MAX_TOOL_RESULT_BYTES } from "../lib/serviceToolCatalog.js";

const unknownOutcome = "The application operation did not return a verified result. Inspect its target before requesting another execution.";

/** The error a call without a verified result ends its turn with. An unsaved call's says nothing of a tool. */
function outcomeUnknown(unsaved) {
  return unsaved
    ? Object.assign(new Error("The assistant could not complete this request."), {
        code: "conversation_request_incomplete", messageCode: "assistant.turn.requestIncomplete", messageParams: {}
      })
    : Object.assign(new Error(unknownOutcome), { code: "conversation_tool_outcome_unknown" });
}

/** A transient tool set's admission check: it has no admission to recheck. */
function authorizeTransientCall() {}

/** A transient tool set's save: its calls live only in memory. */
function saveTransientCalls() {}

/** A transient tool set's announcement: it publishes no events. */
function announceTransientCall() {}

const TRANSIENT_HOOKS = new Set([authorizeTransientCall, saveTransientCalls, announceTransientCall]);

/**
 * One turn's application calls. Native/API adapters only transport these calls.
 * A call to an unsaved tool (its descriptor's `unsaved`) lives in this turn's memory alone: it is
 * never saved, announced or logged, carries no time, and `records()` leaves it out. Only a caller
 * that keeps its calls in the live turn offers such tools (`offerUnsaved`); for any other, the
 * catalogue withholds them, with `unsavedRefusal` as the reason when the caller gives one.
 * @param {object} options
 * @param {import("../types.js").ServiceToolCatalog} options.catalog
 * @param {{ tools: object[], limits?: { maxToolArgumentBytes?: number, maxToolResultBytes?: number } }} [options.toolSet] A tool set resolved earlier for this turn.
 * @param {object} options.context The caller context the calls run as.
 * @param {() => Promise<object>} [options.prepareContext] Maps the context again before each call.
 * @param {AbortSignal} options.signal
 * @param {object[]} [options.previousCalls] The calls this turn already recorded.
 * @param {() => Promise<void> | void} [options.authorize] Rechecks admission; required unless the tool set is transient.
 * @param {(calls: object[]) => Promise<void> | void} [options.save] Saves the turn's calls; required unless the tool set is transient.
 * @param {(event: object) => Promise<void> | void} [options.emit] Announces a call; required unless the tool set is transient.
 * @param {number} [options.maximumCalls]
 * @param {boolean} [options.discoveryOnly]
 * @param {boolean} [options.offerUnsaved] Whether this caller keeps unsaved calls in the live turn, so may offer them.
 * @param {string} [options.unsavedRefusal] Why this caller cannot, for the tool set's `withheld` entries.
 * @param {boolean} [options.transient]
 * @param {boolean} [options.propagateErrors]
 */
export function createConversationTools({ catalog, toolSet: retainedToolSet, context, prepareContext, signal: turnSignal, previousCalls = [],
  authorize = authorizeTransientCall, save = saveTransientCalls, emit = announceTransientCall, maximumCalls = 32, discoveryOnly = false,
  offerUnsaved = false, unsavedRefusal = "", transient = false, propagateErrors = false }) {
  if (transient !== true && [authorize, save, emit].some(hook => typeof hook !== "function" || TRANSIENT_HOOKS.has(hook))) {
    throw new TypeError("Conversation tools require authorization, durable save and event facilities.");
  }
  if (transient === true && previousCalls.length) {
    throw new TypeError("Transient application tools cannot restore a previous execution.");
  }
  if (typeof offerUnsaved !== "boolean") throw new TypeError("Unsaved application tools require an explicit server-side boolean.");
  // readable-check: allow method-probe - input validation: an optional context mapper must be a function
  if (prepareContext !== undefined && typeof prepareContext !== "function") throw new TypeError("Application tool context requires a server-owned mapper.");
  const toolSet = retainedToolSet ?? catalog.resolveToolSet(context, { discoveryOnly, offerUnsaved, unsavedRefusal });
  const unsavedNames = new Set(toolSet.tools.filter(tool => tool.unsaved === true).map(tool => tool.name));
  if (unsavedNames.size && !offerUnsaved) {
    throw new TypeError("This tool set offers unsaved tools, whose calls these application tools would save.");
  }
  // The tool set's own limits: a surface-aware catalogue resolves each surface's set with that surface's.
  // A hand-written catalogue's tool sets may carry none, and keep the catalogue's defaults.
  const maximumArgumentBytes = toolSet.limits?.maxToolArgumentBytes ?? DEFAULT_MAX_TOOL_ARGUMENT_BYTES;
  const maximumResultBytes = toolSet.limits?.maxToolResultBytes ?? DEFAULT_MAX_TOOL_RESULT_BYTES;
  const calls = new Map(structuredClone(previousCalls).map(call => [call.id, call]));
  // This turn's unsaved calls, kept apart so no save or record ever holds them.
  const unsavedCalls = new Map();
  let pending = Promise.resolve();
  let requested = 0;

  function execute(input, { signal = turnSignal } = {}) {
    // Some native engines request tools concurrently. Keep application mutations
    // ordered and recheck admission after each predecessor actually settles.
    const combined = signal === turnSignal ? signal : AbortSignal.any([turnSignal, signal]);
    const operation = pending.then(() => run(input, combined));
    pending = operation.catch(() => {});
    return operation;
  }

  async function run({ id, name, arguments: argumentsText }, signal) {
    await authorize();
    let executionContext = prepareContext ? await prepareContext() : context;
    signal.throwIfAborted();
    if (typeof id !== "string" || !id || id.length > 256 || typeof name !== "string" || !name || name.length > 256 ||
        typeof argumentsText !== "string") throw new TypeError("An application tool requires its call id, name and JSON arguments.");
    if (Buffer.byteLength(argumentsText) > maximumArgumentBytes) throw Object.assign(new Error("The application tool arguments exceed their size limit."), {
      messageCode: "assistant.conversation.toolArgumentsTooLarge", messageParams: {}
    });
    const input = { id, name, arguments: argumentsText };
    if (++requested > maximumCalls) throw Object.assign(new Error("The assistant reached the application tool-call limit for this turn."), {
      messageCode: "assistant.conversation.toolCallLimit", messageParams: {}
    });
    const recorded = calls.get(id) ?? unsavedCalls.get(id);
    if (recorded) {
      if (!isDeepStrictEqual(input, { id: recorded.id, name: recorded.name, arguments: recorded.arguments })) {
        throw new Error("This application tool call id already belongs to different arguments.");
      }
      if (!recorded.result || recorded.status === "unknown") throw outcomeUnknown(unsavedCalls.has(id));
      return structuredClone(recorded.result);
    }
    const unsaved = unsavedNames.has(name);
    let call;
    if (unsaved) {
      // Admission and the context were checked just above; there is no reservation to wait on.
      call = { ...input, status: "running" };
      unsavedCalls.set(id, call);
    } else {
      call = { ...input, status: "running", at: new Date().toISOString() };
      calls.set(id, call);
      // Canonical calls reserve durably before the effect. Explicit transient
      // calls retain the same once-only state only for their non-resumable lifetime.
      try { await save([...calls.values()]); }
      catch (error) { calls.delete(id); throw error; }
      await emit({ type: "tool", call: structuredClone(call) });
      try {
        await authorize();
        if (prepareContext) executionContext = await prepareContext();
        signal.throwIfAborted();
      } catch (error) {
        call.status = "not-executed";
        call.result = { ok: false, error: { code: "conversation_tool_not_executed", message: "Execution stopped before the action began." } };
        await save([...calls.values()]);
        throw error;
      }
    }
    let failed = false;
    let failure;
    call.result = await catalog.executeToolCall({ toolName: name, argumentsText, toolSet, context: { ...executionContext, signal },
      ...(propagateErrors ? { onFailure(error) { failed = true; failure = error; } } : {}) });
    call.status = !call.result.ok && call.result.error?.status >= 500 ? "unknown" : "complete";
    if (!unsaved) {
      // Keep the result in memory as well: retrySave can persist it after a failed
      // write without executing the action again or repeating model inference.
      await save([...calls.values()]);
      await emit({ type: "tool", call: structuredClone(call) });
    }
    if (failed) throw failure;
    if (!call.result.ok && call.result.error?.status >= 500) throw outcomeUnknown(unsaved);
    return structuredClone(call.result);
  }

  const records = () => structuredClone([...calls.values()]);

  return Object.freeze({
    descriptors: toolSet.tools,
    schemas: toolSet.tools.map(catalog.toOpenAiToolSchema),
    execute,
    maximumArgumentBytes,
    maximumResultBytes,
    records
  });
}
