import { applyConversationLogPatch, mergeConversationStream } from "@jskit-ai/assistant-core/shared/conversation";
import {
  ASSISTANT_CONVERSATION_EVENT,
  ASSISTANT_CONVERSATION_SUBSCRIBE,
  ASSISTANT_CONVERSATION_UNSUBSCRIBE
} from "../../shared/conversationRealtime.js";

// Private to the original client history/subscription coordination. Symbols
// survive local snapshot spreads but never enter the conversation wire format.
const refreshedHistoryPages = Symbol("assistant.refreshedHistoryPages");

function patchLoadedHistoryPages(pages = [], patch) {
  return pages.map(page => page.conversationLog.some(turn => turn.turnId === patch?.turn?.turnId)
    ? applyConversationLogPatch(page, patch, { limit: page.pagination?.limit }) || page : page);
}

const SNAPSHOT_EVENTS = new Set(["accepted", "settled", "configuration", "phase", "error", "replaced", "goal"]);

function subscribeAssistantConversation({
  socket, conversationId, targetSurfaceId, hostSurfaceId, workspaceSlug,
  read, onState, onEvent = () => {}, onError = () => {}
} = {}) {
  if (typeof socket?.on !== "function" || typeof socket?.off !== "function" || typeof socket?.timeout !== "function") {
    throw new TypeError("Conversation subscriptions require the application's shared realtime socket.");
  }
  if (typeof read !== "function" || typeof onState !== "function" || typeof onEvent !== "function") {
    throw new TypeError("Conversation subscriptions require a canonical read operation and state listener.");
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
  let reloadInFlight = null;
  let reloadQueued = false;
  const completed = new Map();
  const settledTurns = new Set();
  const pendingReads = new Set();

  function savedMessageIds() {
    return new Set((state?.conversationLog || []).flatMap(turn => turn.messages || [
      turn.system, turn.user, ...(turn.thinking || []), ...(turn.commentary || []), turn.assistant
    ].filter(Boolean)).map(message => message.messageId));
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
    publishState({ ...options, canonical: true });
  }
  function reload() {
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
      // Ported from the original history reader: retain only delivered updates
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
        if ([401, 403].includes(Number(error.status || error.statusCode))) {
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

  function deliver(payload) {
    if (payload.streamEpoch !== epoch || !Number.isSafeInteger(payload.streamRevision) || payload.streamRevision <= revision) return;
    revision = payload.streamRevision;
    const event = payload.event;
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
      // A later initial read can already contain the result of buffered events.
      const older = streaming && event.streaming?.revision < streaming.revision;
      const completedWhileRunning = event.type === "message" && event.status === "complete" &&
        state?.conversationLog.some(turn => turn.turnId === event.turnId && turn.metadata?.runtime?.status === "running");
      if (!older || completedWhileRunning) {
        const previous = streaming?.messages?.find(message => message.messageId === event.messageId);
        const changed = receiveStreaming(event.streaming);
        if (event.type === "message" && event.status === "complete" && event.text) {
          completed.set(event.messageId, { turnId: event.turnId, message: {
            messageId: event.messageId, role: event.role, text: event.text, status: "complete",
            ...(event.outputId ? { outputId: event.outputId } : {}),
            ...(event.turnId ? { turnId: event.turnId } : {}),
            ...(event.origin ? { origin: event.origin } : {}),
            ...(previous?.at ? { at: previous.at } : {})
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
    onEvent(event);
  }
  function receive(payload) {
    if (disposed || !listening || payload?.subscriptionId !== subscriptionId || payload.conversationId !== conversationId) return;
    if (epoch === null) pending.push(payload);
    else deliver(payload);
  }
  function subscribe() {
    if (disposed || !socket.connected) return;
    const attempt = ++generation;
    epoch = null;
    revision = 0;
    pending = [];
    listening = true;
    state = null;
    streaming = null;
    completed.clear();
    settledTurns.clear();
    reloadInFlight = null;
    reloadQueued = false;
    socket.timeout(10_000).emit(ASSISTANT_CONVERSATION_SUBSCRIBE, input, (error, response) => {
      if (disposed || attempt !== generation) return;
      if (error || response?.ok !== true) {
        listening = false;
        pending = [];
        if (socket.connected) socket.emit(ASSISTANT_CONVERSATION_UNSUBSCRIBE, { subscriptionId });
        onError(error ? Object.assign(new Error("Chat updates could not reconnect. Reload chat to try again.", { cause: error }), {
          code: "assistant_subscription_transport_failed"
        }) : Object.assign(new Error(response?.error || "Conversation subscription failed."), {
          code: response?.code, statusCode: response?.status
        }));
        return;
      }
      epoch = response.streamEpoch;
      receiveState(response.state, { initial: true });
      for (const payload of pending.sort((left, right) => left.streamRevision - right.streamRevision)) deliver(payload);
      pending = [];
    });
  }
  function disconnected() {
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
