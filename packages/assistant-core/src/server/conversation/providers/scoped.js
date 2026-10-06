import { normalizeText } from "../normalize.js";
import { createConversationChangeover } from "../continuity.js";

// The host retains profile authority and durable parent receipts. This original
// coordinator uses its admitted operations before and after native creation.
export async function runScopedConversationTurn({ operations, scope = {}, input = {}, context: options = {},
  executionProfile: profileSnapshot } = {}) {
  const request = { ...input, ephemeral: true, message: input.prompt || input.message };
  options.signal?.throwIfAborted();
  let conversationId = normalizeText(input.conversationId || input.threadId);
  if (!conversationId) {
    const created = await operations.createEphemeralConversation(scope, request, options);
    if (created?.ok === false) return created;
    conversationId = normalizeText(created.conversationId);
    if (!conversationId) throw new Error("The helper did not return its conversation identity.");
  }
  // Await ownership before starting: Stop or a failed parent write must not
  // leave an unidentified native turn running.
  await options.onEvent?.({ type: "thread", threadId: conversationId });
  options.signal?.throwIfAborted();
  const started = await operations.startEphemeralConversationTurn(scope, { ...request, conversationId }, options);
  if (started?.ok === false) return { ...started, threadId: conversationId };
  const runId = normalizeText(started.runId);
  await options.onEvent?.({ type: "turn", threadId: conversationId, turnId: runId, status: started.status });
  if (options.signal?.aborted) {
    const stopped = await operations.stopEphemeralConversation(scope, { ...request, conversationId, runId }, options);
    if (stopped?.ok === false) return { ...stopped, threadId: conversationId, turnId: runId };
    options.signal.throwIfAborted();
  }
  let stop;
  const interrupt = () => {
    stop ||= operations.stopEphemeralConversation(scope, { ...request, conversationId, runId }, options);
    void stop.catch(() => {});
  };
  options.signal?.addEventListener("abort", interrupt, { once: true });
  let result;
  let failure;
  try {
    result = await operations.waitForEphemeralConversationTurn(scope, { ...request, conversationId, runId }, options);
    options.signal?.throwIfAborted();
  } catch (error) { failure = error; }
  finally {
    options.signal?.removeEventListener("abort", interrupt);
  }
  try {
    const stopped = await stop;
    if (stopped?.ok === false) throw Object.assign(new Error(stopped.error || "The helper could not confirm a stop."), { code: stopped.code });
  } catch (error) {
    if (failure && error !== failure) error.cause = failure;
    failure = error;
  }
  if (failure) throw failure;
  return { ...result, threadId: conversationId, turnId: runId,
    text: result.rawText || result.text || result.message || "", executionProfile: profileSnapshot,
    ...(["failed", "cancelled", "interrupted"].includes(result.status) ? { ok: false,
      error: result.error || "The helper stopped before completing its answer." } : {}) };
}

const messageWriters = {
  assistant: "writeConversationAssistantMessage",
  commentary: "writeConversationCommentaryMessage",
  thinking: "writeConversationThinkingMessage",
  system: "writeConversationSystemMessage"
};

function requireSuccess(result) {
  if (result?.ok === false) throw Object.assign(new Error(result.error || "Assistant conversation operation failed."), result);
  return result;
}

function qualifyTranscript(turns, record, response, receipts) {
  return turns.map(turn => {
    if (!turn.user || receipts.persisted(turn) ||
        response.admitted === true && turn.user.messageId === record.messageId) return turn;
    const user = { ...turn.user, receipt: false };
    return { ...turn, user, messages: turn.messages.map(message => message.role === "user" ? { ...message, receipt: false } : message) };
  });
}

async function publishTranscript({ sessionId, store, receipts, publish }, context, record, turns, response = {}) {
  const scope = { sessionId, conversationId: record.conversationId };
  const identities = new Set(turns.flatMap(turn => turn.messages.flatMap(message => [message.messageId, message.outputId].filter(Boolean))));
  for (const message of store.readConversationStream(scope).messages) {
    if (identities.has(message.messageId) || identities.has(message.outputId)) store.completeConversationStreamMessage(scope, message.messageId);
  }
  for (const turn of qualifyTranscript(turns, record, response, receipts)) {
    await publish(context, record.conversationId, { payload: {
      conversationLogPatch: { type: "upsert-turn", turn }, conversationStream: store.readConversationStream(scope)
    } });
  }
}

function streamMessage({ sessionId, store, projection, publish }, context, record, event) {
  const message = event.message;
  if (!message || event.threadId !== record.providerConversationId || !event.turnId ||
      !["assistant", "commentary"].includes(message.role || "assistant")) return;
  const value = projection.message(message, record, "stream");
  if (!value) return;
  const scope = { sessionId, conversationId: record.conversationId };
  const conversationStream = store.updateConversationStream(scope, {
    ...value, messageId: value.messageId || value.id,
    turnId: `${event.threadId}:${event.turnId}`,
    nativeIdentity: { threadId: event.threadId, turnId: event.turnId }
  });
  if (conversationStream) void publish(context, record.conversationId, {
    reason: "assistant-stream", payload: { conversationStream }
  }).catch(() => {});
}

// These original persistent-conversation operations run inside the host's
// existing write lease. Their record, transcript and native operations are the
// same facilities used by its retained conversation; no state is copied here.
export async function readPersistentConversation(options) {
  const { sessionId, operations, store, records, projection, receipts, publish,
    includeAccess = false, transcriptQuery } = options;
  let { record } = options;
  const context = projection.context(options.context, record);
  const scope = { sessionId, conversationId: record.conversationId };
  let response = {};
  let turns = await store.readConversationLog(scope);
  const requestTurn = turns.findLast((turn) => turn.user?.messageId === record.messageId);
  const messageScope = projection.messageScope(context, scope, requestTurn);
  const savedIds = new Set(turns.flatMap((turn) => turn.messages.map((message) => message.messageId)));
  const writtenTurnIds = new Set();
  let appended = false;
  if (record.providerConversationId && record.state !== "closing") {
    try {
      response = requireSuccess(await operations.readConversation(sessionId, records.input(record), context));
      for (const message of response.messages || []) {
        const operation = messageWriters[message.role];
        if (operation && message.text && message.complete !== false && !savedIds.has(message.id)) {
          const written = await store[operation](messageScope, {
            ...projection.message(message, record, "stored"), messageId: message.id
          });
          if (written) writtenTurnIds.add(written.turnId);
          appended = true;
        }
      }
      const patch = {
        status: response.status || record.status,
        runId: response.runId || record.runId,
        error: response.error || ""
      };
      if (record.status === "starting" && response.admitted) Object.assign(patch, { draft: "", attachments: [] });
      if (Object.entries(patch).some(([key, value]) => record[key] !== value)) record = await records.save(context, record, patch);
    } catch (error) {
      // A failed read cannot establish that work stopped. Keep Stop available.
      response = { error: error.message, readError: true };
    }
  }
  if (appended) turns = await store.readConversationLog(scope);
  if (writtenTurnIds.size) await publishTranscript(options, context, record, turns.filter(turn => writtenTurnIds.has(turn.turnId)), response);
  if (!response.readError && response.status && !["starting", "inProgress"].includes(response.status) &&
      store.readConversationStream(scope).messages.length) {
    await publish(context, record.conversationId, { payload: { conversationStream: store.clearConversationStream(scope) } });
  }
  const messages = turns.flatMap((turn) => turn.messages.map((message) => ({
    ...message,
    id: message.messageId || `${turn.turnId}:${message.role}:${message.at}`,
    ...(message.role === "user" ? { attachments: turn.user?.attachments || [] } : {}),
    ...(message.role === "user" && !receipts.persisted(turn) &&
      !(response.admitted === true && message.messageId === record.messageId) ? { receipt: false } : {}),
    status: "completed",
    ...projection.messageMetadata(turn)
  })));
  for (const message of response.messages || []) {
    if (message.complete === false && !messages.some((saved) => saved.id === message.id)) {
      const projected = projection.message(message, record, "incomplete");
      if (projected) messages.push({ ...projected, status: response.status });
    }
  }
  return projection.snapshot({ context, record, response, messages, includeAccess,
    readPage: transcriptQuery ? async () => {
      const page = await store.readConversationLogPage(scope, transcriptQuery);
      return { ...page, conversationLog: qualifyTranscript(page.conversationLog, record, response, receipts) };
    } : null
  });
}

export async function startPersistentConversationTurn(options) {
  const { sessionId, input, operations, store, records, prepare, receipts } = options;
  let { record, context } = options;
  const previous = await readPersistentConversation({ ...options, record: { ...record, messageId: input.messageId } });
  if (previous.readError) throw new Error(previous.error);
  if (previous.admitted) return { ...previous, delivered: true, turnId: previous.runId };
  const steering = ["starting", "inProgress"].includes(previous.status);
  const selected = await prepare.selection(sessionId, input, record, steering, context);
  const { settings, assistantSelection } = selected;
  context = selected.context;
  if (!record.providerConversationId) {
    const created = requireSuccess(await operations.createConversation(sessionId, selected.creation, context));
    record = await records.bind(context, record, { providerConversationId: created.conversationId }, {
      ...record, providerConversationId: created.conversationId, assistantSelection, agentSettings: settings
    });
  }
  const prepared = await prepare.message(sessionId, input, record, context, assistantSelection);
  let authoredTurn;
  const writeReceipt = async () => {
    authoredTurn = await store.writeConversationUserMessage({ sessionId, conversationId: record.conversationId }, prepared.receipt);
    return authoredTurn;
  };
  if (!receipts.afterAdmission(input)) await writeReceipt();
  record = await records.save(context, record, {
    ...prepared.presentation,
    agentSettings: settings,
    assistantSelection,
    messageId: input.messageId,
    status: steering ? previous.status : "starting",
    runId: steering ? previous.runId : "",
    error: ""
  });
  try {
    const result = requireSuccess(await operations.startConversationTurn(sessionId,
      records.input(record, { ...input, ...prepared.input, steer: steering }), { ...context, attachmentsPrepared: true,
        onEvent(event) { streamMessage(options, context, record, event); return context.onEvent?.(event); }
      }));
    if (receipts.afterAdmission(input)) await writeReceipt();
    await records.bind(context, record, { runId: result.runId, status: result.status || "inProgress", draft: "", attachments: [] },
      { ...record, runId: result.runId });
    if (authoredTurn) await publishTranscript(options, context, record, [authoredTurn], { admitted: true });
    return { ...result, delivered: true, turnId: result.runId, conversationId: record.conversationId };
  } catch (error) {
    const observed = await readPersistentConversation({ ...options, context, record });
    if (observed.admitted) {
      if (receipts.afterAdmission(input)) await writeReceipt();
      return { ...observed, delivered: true, turnId: observed.runId };
    }
    if (observed.readError && !receipts.afterAdmission(input)) return {
      ...observed, ok: false, delivered: false, status: "uncertain", messageId: input.messageId, error: error.message
    };
    await records.save(context, record, { error: error.message, status: "failed" });
    throw error;
  }
}

export async function inspectPersistentConversationAdmission(options) {
  const { sessionId, record, input, operations, inputFor } = options;
  if (input.threadId && input.threadId !== record.providerConversationId) return { admission: "unknown", turnId: "" };
  if (!record.providerConversationId) return { admission: "unknown", turnId: "" };
  const state = requireSuccess(await operations.readConversation(sessionId,
    inputFor(record, { messageId: input.messageId }), options.context));
  return { admission: state.admitted ? "accepted" : "unknown", turnId: state.runId };
}

export async function preparePersistentConversationChangeover(options) {
  const { sessionId, operations, records, prepare, context, changeoverContext } = options;
  let { record } = options;
  const observed = await readPersistentConversation(options);
  if (observed.readError) throw new Error(observed.error);
  const current = await records.read(context, record.conversationId);
  const native = current.providerConversationId ? requireSuccess(await operations.readConversation(sessionId,
    records.input(current), context)) : { status: "ready" };
  if (["starting", "inProgress"].includes(native.status)) throw new Error("Stop this temporary conversation before changing its AI.");
  record = await records.read(context, record.conversationId);
  if (record.providerConversationId) {
    requireSuccess(await operations.stopConversation(sessionId, records.input(record, { runId: record.runId }), context));
    record = await records.bind(changeoverContext, record, {}, record);
  }
  const { engineId, messages, ...continuity } = await prepare.continuity(sessionId, changeoverContext, { remember: true });
  await createConversationChangeover(continuity).remember({ engineId, messages });
}

export async function inspectPersistentConversationDelivery(options) {
  const { sessionId, input, context, store, operations, prepare, receipts } = options;
  let turns = await store.readConversationLog(sessionId);
  let row = turns.find(turn => turn.user?.messageId === input.messageId);
  let accepted = options.delivered === true;
  const pending = receipts.pending(context);
  if (pending?.messageId === input.messageId && pending.attempted) {
    const inspectMessageAdmission = operations.inspectMessageAdmission;
    const { engineId, messages, turnMetadata, ...continuity } = await prepare.continuity(sessionId, context);
    const result = await createConversationChangeover({ ...continuity, agent: {
      inspectMessageAdmission: request => inspectMessageAdmission(sessionId, request, context),
      sendMessage() { throw new Error("Receipt inspection cannot submit another native prompt."); }
    } }).send({ engineId, messages, input: { messageId: input.messageId }, turnMetadata });
    accepted = result?.delivered === true;
  } else if (!accepted) {
    if (row && row.user?.receipt !== false) return { status: "accepted", messageId: input.messageId, turnId: row.turnId, duplicate: true };
    const receipt = await operations.inspectMessageAdmission(sessionId, { messageId: input.messageId }, context).catch(() => null);
    accepted = receipt?.admission === "accepted";
  }
  if (!accepted) return { status: "unknown", messageId: input.messageId };
  turns = await store.readConversationLog(sessionId);
  row = turns.find(turn => turn.user?.messageId === input.messageId);
  return { status: "accepted", messageId: input.messageId, ...(row ? { turnId: row.turnId } : {}), duplicate: true };
}

export async function stopPersistentConversation({ sessionId, record, context, operations, records, projection }) {
  if (record.providerConversationId) requireSuccess(await operations.stopConversation(sessionId,
    records.input(record, { runId: record.runId }), projection.context(context, record)));
  await records.save(context, record, { status: "interrupted", error: "" });
  return { ok: true, status: "interrupted", conversationId: record.conversationId };
}

export async function deletePersistentConversation({ sessionId, record, context, operations, records, projection }) {
  record = await records.save(context, record, { state: "closing", error: "" });
  context = projection.context(context, record);
  try {
    for (const [key, binding] of records.retained(record)) {
      const retained = records.select(record, binding);
      const selected = projection.context(context, retained);
      requireSuccess(await operations.stopConversation(sessionId, records.input(retained, { runId: retained.runId }), selected));
      requireSuccess(await operations.deleteConversation(sessionId, records.input(retained), selected));
      record = await records.release(context, record, key, binding);
    }
    await records.delete(context, record, sessionId);
    return { ok: true, deleted: true, conversationId: record.conversationId };
  } catch (error) {
    await records.save(context, record, { error: error.message });
    throw error;
  }
}
