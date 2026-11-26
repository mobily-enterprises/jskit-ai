import { applyConversationLogPatch, conversationTurnMessages, mergeConversationStream } from "@jskit-ai/assistant-core/shared/conversation";
import {
  ASSISTANT_CONVERSATION_EVENT,
  ASSISTANT_CONVERSATION_RESYNC,
  ASSISTANT_CONVERSATION_SUBSCRIBE,
  ASSISTANT_CONVERSATION_UNSUBSCRIBE
} from "../../shared/conversationRealtime.js";
import { isAccessDenied } from "./conversationFailures.js";

/**
 * A whole stream snapshot's messages by id, the base the next delta applies to; null when they are not each named by a
 * distinct messageId.
 * @param {any} snapshot
 */
function streamMessages(snapshot) {
  if (!Array.isArray(snapshot?.messages)) return null;
  const messages = new Map();
  for (const message of snapshot.messages) {
    if (typeof message?.messageId !== "string" || messages.has(message.messageId)) return null;
    messages.set(message.messageId, message);
  }
  return messages;
}

/**
 * The stream after one delta (see the server's streamDelta), or null when the delta does not fit the stream it
 * names: it appends to a message the stream does not hold.
 * @param {Map<string, any>} base
 * @param {any} delta
 */
function applyStreamDelta(base, delta) {
  const messages = new Map(base);
  for (const id of delta.removed || []) messages.delete(id);
  for (const [id, text] of delta.appended || []) {
    const message = messages.get(id);
    if (typeof message?.text !== "string" || typeof text !== "string") return null;
    messages.set(id, { ...message, text: message.text + text });
  }
  for (const message of delta.messages || []) messages.set(message.messageId, message);
  return messages;
}

// Private to the conversation history and its subscription. Symbols
// survive local snapshot spreads but never enter the conversation wire format.
const refreshedHistoryPages = Symbol("assistant.refreshedHistoryPages");

/**
 * Applies a transcript patch to the loaded older page that holds its turn.
 * @param {any[]} pages
 * @param {any} patch
 */
function patchLoadedHistoryPages(pages, patch) {
  return pages.map(page => page.conversationLog.some(turn => turn.turnId === patch?.turn?.turnId)
    ? applyConversationLogPatch(page, patch, { limit: page.pagination?.limit }) || page : page);
}

const SNAPSHOT_EVENTS = new Set(["accepted", "settled", "configuration", "phase", "error", "replaced", "goal"]);
// A connected but busy server may need longer than the notice budget to answer.
// Abandoning it then would discard the server's work and repeat it, so a slow
// answer only shows a loading notice; it is treated as lost, unsubscribed and
// retried only after the much longer cap.
const SUBSCRIPTION_NOTICE_MS = 10_000;
const SUBSCRIPTION_LOST_MS = 120_000;

/** A subscriber that leaves conversation events to its state listener. */
function ignoreConversationEvent() {}
/** A subscriber that shows no subscription failure. */
function ignoreSubscriptionError() {}

/**
 * Subscribes to one conversation over the shared realtime socket: a canonical read, then live events applied in
 * stream order. Returns the release, which also carries `reload`.
 * @param {{
 *   socket: import("../types.js").RealtimeSocket,
 *   conversationId: string,
 *   targetSurfaceId: string,
 *   hostSurfaceId: string,
 *   workspaceSlug?: string,
 *   read: (read: { current: () => boolean }) => Promise<any>,
 *   onState: (state: any, options: { initial: boolean, canonical: boolean }) => void,
 *   onEvent?: (event: any) => void,
 *   onError?: (failure: Error) => void,
 *   noticeMs?: number
 * }} subscription `noticeMs` is how long an unanswered subscription waits before the loading notice: ten seconds,
 *   shorter only in tests.
 */
function subscribeAssistantConversation({
  socket, conversationId, targetSurfaceId, hostSurfaceId, workspaceSlug,
  read, onState, onEvent = ignoreConversationEvent, onError = ignoreSubscriptionError, noticeMs = SUBSCRIPTION_NOTICE_MS
}) {
  // readable-check: allow method-probe - input validation: an application may hand the conversation binding its own socket
  if (typeof socket?.on !== "function" || typeof socket?.off !== "function" || typeof socket?.timeout !== "function") {
    throw new TypeError("Conversation subscriptions require the application's shared realtime socket.");
  }
  const subscriptionId = crypto.randomUUID();
  const input = { subscriptionId, conversationId, targetSurfaceId, hostSurfaceId,
    ...(workspaceSlug === undefined ? {} : { workspaceSlug }) };
  let disposed = false;
  let generation = 0;
  let epoch = null;
  let revision = 0;
  let pending = [];
  let listening = false;
  let state = null;
  let streaming = null;
  // The stream as this subscription's events left it: the base of the next in-progress delta, and its number.
  // Null messages mean no base: the next stream part must be whole.
  let stream = { seq: 0, messages: /** @type {Map<string, any> | null} */ (null) };
  let reloadInFlight = null;
  let reloadQueued = false;
  // A transient subscription failure retries while the socket stays connected;
  // otherwise only the next connect would recover the chat.
  let retryTimer = null;
  let retryDelay = 1_000;
  let waitingTimer = null;
  const completed = new Map();
  const settledTurns = new Set();
  const pendingReads = new Set();

  function savedMessageIds() {
    return new Set((state?.conversationLog || []).flatMap(conversationTurnMessages).map(message => message.messageId));
  }
  function receiveStreaming(snapshot) {
    if (!Number.isSafeInteger(snapshot?.revision) || (streaming && snapshot.revision <= streaming.revision)) return false;
    streaming = snapshot;
    return true;
  }
  function publishState({ initial = false, canonical = false } = {}) {
    if (!state) return;
    const saved = savedMessageIds();
    for (const id of completed.keys()) if (saved.has(id)) completed.delete(id);
    const messages = new Map([...completed].map(([id, entry]) => [id, entry.message]));
    for (const message of streaming?.messages || []) messages.set(message.messageId, message);
    // Saved history owns completed identities; events only supply a display overlay.
    onState({ ...state, streaming, turns: mergeConversationStream(state.conversationLog, { messages: [...messages.values()] }) }, { initial, canonical });
  }
  function receiveState(snapshot, options) {
    state = snapshot;
    receiveStreaming(snapshot.streaming);
    publishState({ canonical: true, ...options });
  }
  function reload({ resubscribe = false } = {}) {
    if (resubscribe) return subscribe({ preserveHistory: true });
    if (!listening) return subscribe();
    if (reloadInFlight) {
      reloadQueued = true;
      return reloadInFlight;
    }
    const attempt = generation;
    const settled = new Set(settledTurns);
    settledTurns.clear();
    const current = () => !disposed && listening && attempt === generation;
    const pendingRead = { generation: attempt, patches: [] };
    const job = Promise.resolve().then(() => {
      if (!current()) return null;
      pendingReads.add(pendingRead);
      return read({ current });
    }).then(snapshot => {
      if (!current()) return;
      // Retain only delivered updates
      // received while this request was in flight before replacing its cache.
      for (const patch of pendingRead.patches) {
        snapshot = applyConversationLogPatch(snapshot, patch, { limit: snapshot.pagination?.limit });
        if (snapshot[refreshedHistoryPages]) {
          snapshot[refreshedHistoryPages] = patchLoadedHistoryPages(snapshot[refreshedHistoryPages], patch);
        }
      }
      for (const [id, entry] of completed) if (settled.has(entry.turnId)) completed.delete(id);
      receiveState(snapshot);
    }).catch(error => {
      if (current()) {
        if (isAccessDenied(error)) {
          if (epoch === null) {
            disconnected();
            if (socket.connected) socket.emit(ASSISTANT_CONVERSATION_UNSUBSCRIBE, { subscriptionId });
          } else {
            // Retain invalidation notifications for a fresh authorized read, not cached content.
            generation += 1;
            reloadInFlight = null;
            reloadQueued = false;
          }
          state = null;
          streaming = null;
          completed.clear();
          settledTurns.clear();
        }
        onError(error);
      }
    }).finally(() => {
      pendingReads.delete(pendingRead);
      if (reloadInFlight !== job) return;
      reloadInFlight = null;
      if (reloadQueued && current()) {
        reloadQueued = false;
        reload();
      }
    });
    reloadInFlight = job;
    return job;
  }

  /**
   * The event a payload carries, with its stream rebuilt when it carries only what changed (`streamDelta`). A delta
   * that does not follow the stream part before it (one was missed) asks the server for the whole stream; its event
   * then goes on without stream or text, and reaches no listener.
   * @param {any} payload
   */
  function receivedEvent(payload) {
    const event = payload.event;
    if (!Number.isSafeInteger(payload.streamSeq)) return { event, notify: true };
    if (!Object.hasOwn(event, "streamDelta")) {
      stream = { seq: payload.streamSeq, messages: streamMessages(event.streaming) };
      return { event, notify: true };
    }
    const { streamDelta: delta, ...notice } = event;
    const messages = stream.messages && payload.streamSeq === stream.seq + 1 ? applyStreamDelta(stream.messages, delta) : null;
    stream = { seq: payload.streamSeq, messages };
    if (!messages) {
      if (socket.connected) socket.emit(ASSISTANT_CONVERSATION_RESYNC, { subscriptionId, streamEpoch: epoch, streamSeq: payload.streamSeq });
      return { event: notice, notify: false };
    }
    const text = notice.type === "message" && !Object.hasOwn(notice, "text") ? messages.get(notice.messageId)?.text : undefined;
    return { event: { ...notice, ...(text === undefined ? {} : { text }), streaming: { revision: delta.revision,
      messages: [...messages.values()], ...(delta.completedMessages === undefined ? {} : { completedMessages: delta.completedMessages }) } },
    notify: true };
  }

  function deliver(payload) {
    if (payload.streamEpoch !== epoch || !Number.isSafeInteger(payload.streamRevision) || payload.streamRevision <= revision) return;
    revision = payload.streamRevision;
    const { event, notify } = receivedEvent(payload);
    if (event.type === "stream-resync") {
      // The whole stream again after a missed part: presentation only, not a conversation event.
      if (state && receiveStreaming(event.streaming)) publishState();
      return;
    }
    if (!state) {
      if (SNAPSHOT_EVENTS.has(event.type)) reload();
      return;
    }
    let changedPresentation = Object.hasOwn(event, "interimReply");
    if (changedPresentation && state) state = { ...state, interimReply: event.interimReply };
    if (event.type === "transcript") {
      const next = applyConversationLogPatch(state, event.patch, { limit: state?.pagination?.limit });
      if (next) {
        state = next;
        for (const read of pendingReads) {
          if (read.generation === generation) read.patches.push(event.patch);
        }
        receiveStreaming(event.streaming);
        changedPresentation = true;
      }
    } else if (event.type === "message" || event.type === "message-complete") {
      // A saved turn can be outside the loaded page. Its transcript patch owns
      // presentation; the following completion must not recreate it at the tail.
      const persisted = event.type === "message" && event.status === "complete" && event.persisted === true;
      if (persisted) changedPresentation = completed.delete(event.messageId) || changedPresentation;
      // A later initial read can already contain the result of buffered events.
      const older = streaming && event.streaming?.revision < streaming.revision;
      const completedWhileRunning = event.type === "message" && event.status === "complete" &&
        state?.conversationLog.some(turn => turn.turnId === event.turnId && turn.metadata?.runtime?.status === "running");
      if (!older || completedWhileRunning) {
        const previous = streaming?.messages?.find(message => message.messageId === event.messageId);
        const changed = receiveStreaming(event.streaming);
        if (event.type === "message" && event.status === "complete" && event.text && !persisted) {
          completed.set(event.messageId, { turnId: event.turnId, message: {
            messageId: event.messageId, role: event.role, text: event.text, status: "complete",
            ...(event.outputId ? { outputId: event.outputId } : {}),
            ...(event.turnId ? { turnId: event.turnId } : {}),
            ...(event.origin ? { origin: event.origin } : {}),
            ...((event.at || previous?.at) ? { at: event.at || previous.at } : {})
          } });
        }
        changedPresentation ||= changed || event.status === "complete";
      }
    } else if (SNAPSHOT_EVENTS.has(event.type)) {
      if (event.type === "settled") settledTurns.add(event.turnId);
      if (event.type === "replaced") completed.clear();
      reload();
    }
    if (changedPresentation) publishState();
    // Events are notifications. Transcript presentation comes from onState.turns.
    if (notify) onEvent(event);
  }
  function receive(payload) {
    if (disposed || !listening || payload?.subscriptionId !== subscriptionId || payload.conversationId !== conversationId) return;
    if (epoch === null) pending.push(payload);
    else deliver(payload);
  }
  function clearTimers() {
    clearTimeout(retryTimer);
    retryTimer = null;
    clearTimeout(waitingTimer);
    waitingTimer = null;
  }
  function subscribe({ preserveHistory = false } = {}) {
    clearTimers();
    if (disposed || !socket.connected) return;
    const attempt = ++generation;
    epoch = null;
    revision = 0;
    pending = [];
    listening = true;
    state = null;
    streaming = null;
    stream = { seq: 0, messages: null };
    completed.clear();
    settledTurns.clear();
    reloadInFlight = null;
    reloadQueued = false;
    waitingTimer = setTimeout(() => onError(Object.assign(
      new Error("Chat is still loading. Waiting for the server; Reload chat to try now."),
      { code: "assistant_subscription_waiting" })), noticeMs);
    socket.timeout(SUBSCRIPTION_LOST_MS).emit(ASSISTANT_CONVERSATION_SUBSCRIBE, input, (error, response) => {
      if (disposed || attempt !== generation) return;
      clearTimers();
      if (error || response?.ok !== true) {
        listening = false;
        pending = [];
        if (socket.connected) socket.emit(ASSISTANT_CONVERSATION_UNSUBSCRIBE, { subscriptionId });
        if (error || response?.status >= 500) {
          retryTimer = setTimeout(() => subscribe({ preserveHistory }), retryDelay);
          retryDelay = Math.min(retryDelay * 2, 30_000);
        }
        if (error) {
          onError(Object.assign(new Error("Chat updates could not reconnect. Retrying automatically; Reload chat to try now.", { cause: error }), {
            code: "assistant_subscription_transport_failed"
          }));
          return;
        }
        onError(Object.assign(new Error(response?.error || "Conversation subscription failed."), {
          code: response?.code, statusCode: response?.status, params: response?.params,
          ...(response?.error ? { messageCode: response.messageCode, messageParams: response.messageParams }
            : { messageCode: "assistant.runtime.subscription.failed" })
        }));
        return;
      }
      retryDelay = 1_000;
      epoch = response.streamEpoch;
      receiveState(response.state, { initial: !preserveHistory, canonical: !preserveHistory });
      for (const payload of pending.sort((left, right) => left.streamRevision - right.streamRevision)) deliver(payload);
      pending = [];
    });
  }
  function disconnected() {
    clearTimers();
    generation += 1;
    epoch = null;
    pending = [];
    listening = false;
    reloadInFlight = null;
    reloadQueued = false;
  }
  socket.on(ASSISTANT_CONVERSATION_EVENT, receive);
  socket.on("connect", subscribe);
  socket.on("disconnect", disconnected);
  subscribe();

  function release() {
    if (disposed) return;
    disposed = true;
    clearTimers();
    generation += 1;
    pending = [];
    completed.clear();
    socket.off(ASSISTANT_CONVERSATION_EVENT, receive);
    socket.off("connect", subscribe);
    socket.off("disconnect", disconnected);
    if (socket.connected) socket.emit(ASSISTANT_CONVERSATION_UNSUBSCRIBE, { subscriptionId });
  }
  return Object.assign(release, { reload });
}

export { subscribeAssistantConversation, refreshedHistoryPages, patchLoadedHistoryPages };
