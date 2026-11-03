import { isDeepStrictEqual } from "node:util";

const unknownOutcome = "The application operation did not return a verified result. Inspect its target before requesting another execution.";

/** A transient tool set's admission check: it has no admission to recheck. */
function authorizeTransientCall() {}

/** A transient tool set's save: its calls live only in memory. */
function saveTransientCalls() {}

/** A transient tool set's announcement: it publishes no events. */
function announceTransientCall() {}

const TRANSIENT_HOOKS = new Set([authorizeTransientCall, saveTransientCalls, announceTransientCall]);

/**
 * One turn's application calls. Native/API adapters only transport these calls.
 * @param {object} options
 * @param {import("../types.js").ServiceToolCatalog} options.catalog
 * @param {{ tools: object[] }} [options.toolSet] A tool set resolved earlier for this turn.
 * @param {object} options.context The caller context the calls run as.
 * @param {() => Promise<object>} [options.prepareContext] Maps the context again before each call.
 * @param {AbortSignal} options.signal
 * @param {object[]} [options.previousCalls] The calls this turn already recorded.
 * @param {() => Promise<void> | void} [options.authorize] Rechecks admission; required unless the tool set is transient.
 * @param {(calls: object[]) => Promise<void> | void} [options.save] Saves the turn's calls; required unless the tool set is transient.
 * @param {(event: object) => Promise<void> | void} [options.emit] Announces a call; required unless the tool set is transient.
 * @param {number} [options.maximumCalls]
 * @param {boolean} [options.discoveryOnly]
 * @param {boolean} [options.transient]
 * @param {boolean} [options.propagateErrors]
 */
export function createConversationTools({ catalog, toolSet: retainedToolSet, context, prepareContext, signal: turnSignal, previousCalls = [],
  authorize = authorizeTransientCall, save = saveTransientCalls, emit = announceTransientCall, maximumCalls = 32, discoveryOnly = false,
  transient = false, propagateErrors = false }) {
  if (transient !== true && [authorize, save, emit].some(hook => typeof hook !== "function" || TRANSIENT_HOOKS.has(hook))) {
    throw new TypeError("Conversation tools require authorization, durable save and event facilities.");
  }
  if (transient === true && previousCalls.length) {
    throw new TypeError("Transient application tools cannot restore a previous execution.");
  }
  // readable-check: allow method-probe - input validation: an optional context mapper must be a function
  if (prepareContext !== undefined && typeof prepareContext !== "function") throw new TypeError("Application tool context requires a server-owned mapper.");
  const toolSet = retainedToolSet ?? catalog.resolveToolSet(context, { discoveryOnly });
  const calls = new Map(structuredClone(previousCalls).map(call => [call.id, call]));
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
    if (Buffer.byteLength(argumentsText) > catalog.limits.maxToolArgumentBytes) throw new Error("The application tool arguments exceed their size limit.");
    const input = { id, name, arguments: argumentsText };
    if (++requested > maximumCalls) throw new Error("The assistant reached the application tool-call limit for this turn.");
    const recorded = calls.get(id);
    if (recorded) {
      if (!isDeepStrictEqual(input, { id: recorded.id, name: recorded.name, arguments: recorded.arguments })) {
        throw new Error("This application tool call id already belongs to different arguments.");
      }
      if (!recorded.result || recorded.status === "unknown") {
        throw Object.assign(new Error(unknownOutcome), { code: "conversation_tool_outcome_unknown" });
      }
      return structuredClone(recorded.result);
    }
    const call = { ...input, status: "running", at: new Date().toISOString() };
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
    let failed = false;
    let failure;
    call.result = await catalog.executeToolCall({ toolName: name, argumentsText, toolSet, context: { ...executionContext, signal },
      ...(propagateErrors ? { onFailure(error) { failed = true; failure = error; } } : {}) });
    call.status = !call.result.ok && call.result.error?.status >= 500 ? "unknown" : "complete";
    // Keep the result in memory as well: retrySave can persist it after a failed
    // write without executing the action again or repeating model inference.
    await save([...calls.values()]);
    await emit({ type: "tool", call: structuredClone(call) });
    if (failed) throw failure;
    if (!call.result.ok && call.result.error?.status >= 500) {
      throw Object.assign(new Error(unknownOutcome), { code: "conversation_tool_outcome_unknown" });
    }
    return structuredClone(call.result);
  }

  const records = () => structuredClone([...calls.values()]);

  return Object.freeze({
    descriptors: toolSet.tools,
    schemas: toolSet.tools.map(catalog.toOpenAiToolSchema),
    execute,
    maximumArgumentBytes: catalog.limits.maxToolArgumentBytes,
    records
  });
}
