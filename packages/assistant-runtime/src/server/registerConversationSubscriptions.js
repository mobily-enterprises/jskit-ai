import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { attachDirectRequestActionExecutor } from "@jskit-ai/kernel/server/http";
import { AppError, hideDatabaseError } from "@jskit-ai/kernel/server/runtime";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { actionIds } from "./actionIds.js";
import { resolveRouteRequestState } from "./support/assistantRouteContext.js";
import { errorMessageFields, errorStatus } from "./support/assistantErrors.js";
import { requireAssistantSurface } from "./support/assistantSurface.js";
import {
  ASSISTANT_CONVERSATION_EVENT,
  ASSISTANT_CONVERSATION_RESYNC,
  ASSISTANT_CONVERSATION_SUBSCRIBE,
  ASSISTANT_CONVERSATION_UNSUBSCRIBE
} from "../shared/conversationRealtime.js";

/**
 * A stream snapshot (`{ revision, messages, completedMessages? }`) as the base of the next delta: its revision and
 * its messages by id, in order. Null when its messages are not each named by a distinct messageId.
 * @param {{ revision?: unknown, messages: any[] }} snapshot
 */
function streamState(snapshot) {
  const messages = new Map();
  for (const message of snapshot.messages) {
    const id = message?.messageId;
    if (typeof id !== "string" || messages.has(id)) return null;
    messages.set(id, message);
  }
  return { revision: snapshot.revision, messages };
}

/** @param {any} snapshot */
function isStreamSnapshot(snapshot) {
  return Boolean(snapshot) && typeof snapshot === "object" && Array.isArray(snapshot.messages);
}

/**
 * Whether two stream messages differ in nothing but their text.
 * @param {Record<string, unknown>} left
 * @param {Record<string, unknown>} right
 */
function sameBesidesText(left, right) {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every(key => key === "text" || (Object.hasOwn(right, key) && isDeepStrictEqual(left[key], right[key])));
}

/**
 * What changed from the stream a subscriber was last sent to the next one: unchanged messages are left out, a message
 * whose text only grew is the text it gained (`appended`), any other message goes whole (`messages`, in stream order),
 * and one no longer streaming is named in `removed`. Null when the messages both streams hold changed their order,
 * which only a whole stream can say.
 * @param {{ messages: Map<string, any> }} sent
 * @param {{ messages: Map<string, any> }} next
 * @param {{ revision?: unknown, completedMessages?: unknown }} snapshot
 */
function streamDelta(sent, next, snapshot) {
  const order = [...next.messages.keys()];
  const kept = [...sent.messages.keys()].filter(id => next.messages.has(id));
  if (kept.some((id, index) => order[index] !== id)) return null;
  const removed = [...sent.messages.keys()].filter(id => !next.messages.has(id));
  const appended = [];
  const messages = [];
  for (const [id, message] of next.messages) {
    const previous = sent.messages.get(id);
    if (previous && sameBesidesText(previous, message)) {
      if (previous.text === message.text) continue;
      if (typeof previous.text === "string" && typeof message.text === "string" && message.text.startsWith(previous.text)) {
        appended.push([id, message.text.slice(previous.text.length)]);
        continue;
      }
    }
    messages.push(message);
  }
  return { revision: snapshot.revision,
    ...(appended.length ? { appended } : {}),
    ...(messages.length ? { messages } : {}),
    ...(removed.length ? { removed } : {}),
    ...(snapshot.completedMessages !== undefined ? { completedMessages: snapshot.completedMessages } : {}) };
}

function requireSubscriptionId(input) {
  if (typeof input?.subscriptionId !== "string" || !input.subscriptionId.trim() || input.subscriptionId.length > 128) {
    throw new AppError(400, "A conversation subscription id is required.", { code: "assistant.runtime.subscription.idRequired" });
  }
  return input.subscriptionId;
}

function subscriptionError(error) {
  const status = errorStatus(error);
  const exposed = status < 500 && Boolean(error.message);
  const code = String(error?.code || "assistant_subscription_failed");
  return {
    ok: false,
    error: exposed ? String(error.message) : "Conversation subscription failed.",
    code,
    ...(exposed ? errorMessageFields(error, { expose: code !== "ACTION_PERMISSION_DENIED" })
      : { params: {}, messageCode: "assistant.runtime.subscription.failed", messageParams: {} }),
    status
  };
}

/** A subscription without diagnostics has none to release. */
function releaseNoDiagnostics() {}

/** A subscription whose observer is not attached yet has nothing to detach. */
function detachNoObserver() {}

/**
 * Register one conversation subscription owner per shared realtime runtime.
 * A host may select its fixed action/request policy at composition; clients
 * never choose either. The selected action remains the authorization boundary.
 * @param {object} dependencies
 * @param {import("@jskit-ai/realtime/server/types").RuntimeRealtime} dependencies.realtime
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEvents} dependencies.events
 * @param {import("@jskit-ai/kernel/server/types").ActionCatalogue} dependencies.actions
 * @param {Record<string, any>} [dependencies.config]
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} [dependencies.logger]
 * @param {import("./types.js").WorkspaceScopeSupport | null} [dependencies.workspaceScopeSupport]
 * @param {string} [dependencies.subscribeActionId]
 * @param {"authenticated" | "host"} [dependencies.requestPolicy]
 * @param {boolean} [dependencies.diagnostics]
 */
function registerConversationSubscriptions({ realtime, events, actions, config = {}, logger = silentLogger, workspaceScopeSupport = null,
  subscribeActionId = actionIds.conversationSubscribe, requestPolicy = "authenticated", diagnostics = false } = {}) {
  // readable-check: allow method-probe - input validation: an application hands over its realtime connection and event runtime
  if (typeof realtime?.onConnection !== "function" || typeof events?.publish !== "function") {
    throw new TypeError("Conversation subscriptions require the shared realtime connection and event runtime.");
  }
  // readable-check: allow method-probe - input validation: an application hands over its action catalogue
  if (typeof actions?.execute !== "function" || typeof actions?.getDefinition !== "function") {
    throw new TypeError("Conversation subscriptions require the assistant action catalogue.");
  }
  if (!["authenticated", "host"].includes(requestPolicy)) {
    throw new TypeError("Conversation subscription requestPolicy must be authenticated or host.");
  }
  if (typeof subscribeActionId !== "string" || !subscribeActionId.trim() ||
      (requestPolicy === "host" && subscribeActionId === actionIds.conversationSubscribe)) {
    throw new TypeError("Host conversation subscriptions require an explicit product subscribeActionId.");
  }

  return realtime.onConnection(({ socket, authenticate, readRequest }) => {
    const subscriptions = new Map();
    let closed = false;

    function release(subscriptionId, reason = "unsubscribe") {
      const subscription = subscriptions.get(subscriptionId);
      if (!subscription) return;
      subscriptions.delete(subscriptionId);
      subscription.diagnosticRelease(reason);
      clearTimeout(subscription.timer);
      subscription.pending.clear();
      subscription.release();
    }

    async function subscribe(input, acknowledge) {
      if (typeof acknowledge !== "function" || closed) return;
      let subscription;
      let subscriptionId;
      const startedAt = performance.now();
      let stageStartedAt = startedAt;
      let stage = "request-admission";
      let observedConversationId;
      let diagnosticTimer;
      function stageRecord(stageName, fields, now) {
        return { event: "assistant.conversation.subscription", subscriptionEpoch: subscription?.epoch,
          ...(typeof observedConversationId === "string" ? { conversationId: observedConversationId } : {}),
          stage: stageName, previousStage: stage, durationMs: now - stageStartedAt, elapsedMs: now - startedAt, ...fields };
      }
      function diagnostic(stageName, fields = {}) {
        if (!diagnostics) return;
        const now = performance.now();
        try {
          logger.warn(stageRecord(stageName, fields, now), "Assistant conversation subscription diagnostic.");
        } catch { /* Diagnostics never change admission or cleanup. */ }
      }
      function onStage(next, fields = {}) {
        const now = performance.now();
        // Only a successfully opened, authorized conversation may enter diagnostics.
        if (next === "observer-attach") observedConversationId = input.conversationId;
        try {
          const slowOutcome = now - startedAt >= 5_000 && ["acknowledgement", "abandoned"].includes(next);
          const level = diagnostics || next === "failed" || slowOutcome ? "warn" : "info";
          logger[level](stageRecord(next, fields, now), "Assistant conversation subscription stage");
        } catch { /* Diagnostics must not change conversation admission or cleanup. */ }
        stage = next;
        stageStartedAt = now;
      }
      try {
        subscriptionId = requireSubscriptionId(input);
        release(subscriptionId, "replacement");
        // streamSeq numbers the events that carry the stream, sentStream is the stream they left the subscriber with,
        // and wholeSeq is the last that carried it whole.
        subscription = { pending: new Map(), revision: 0, epoch: randomUUID(), queue: Promise.resolve(),
          streamSeq: 0, sentStream: null, wholeSeq: 0, resync: false, requestWhole: null,
          diagnosticRelease: releaseNoDiagnostics, release: detachNoObserver };
        subscriptions.set(subscriptionId, subscription);
        if (diagnostics) {
          subscription.diagnosticRelease = reason => {
            clearTimeout(diagnosticTimer);
            diagnostic("released", { reason });
          };
          diagnosticTimer = setTimeout(() => diagnostic("pending", { acknowledgementBudgetMs: 10_000 }), 10_000);
          diagnosticTimer.unref();
        }
        const current = () => !closed && socket.connected && subscriptions.get(subscriptionId) === subscription;
        onStage("authentication");
        const request = await (requestPolicy === "host" ? readRequest() : authenticate());
        if (!current()) { onStage("abandoned"); return; }
        onStage("action-admission");
        const assistantSurface = requireAssistantSurface(config, input.targetSurfaceId);
        const requiresWorkspace = assistantSurface.runtimeSurfaceRequiresWorkspace;
        request.headers = { ...request.headers, "x-jskit-surface": input.hostSurfaceId };
        request.input = { params: {
          surfaceId: input.targetSurfaceId,
          ...(Object.hasOwn(input, "workspaceSlug") ? { workspaceSlug: input.workspaceSlug } : {})
        } };
        request.routeOptions = { config: { visibility: requiresWorkspace ? "workspace" : "public" } };
        const routeState = resolveRouteRequestState(request, {
          resolveCurrentAppConfig: () => config, requiresWorkspace, workspaceScopeSupport
        });
        attachDirectRequestActionExecutor({ actions, request });
        const actorId = resolveActorId(null, request);

        /**
         * The event as this subscriber receives it. An event that carries the stream is numbered (streamSeq); an
         * in-progress message carries only what changed since the stream this subscriber was last sent, and its text
         * when that is the stream's. Every other event, the first of a subscription and the first after a resync
         * carry the stream whole, so a complete message or settlement never depends on deltas.
         * @param {any} event
         */
        function streamPart(event) {
          if (!isStreamSnapshot(event.streaming)) return { event };
          const streamSeq = ++subscription.streamSeq;
          const sent = subscription.sentStream;
          const next = streamState(event.streaming);
          subscription.sentStream = next;
          const delta = event.type === "message" && event.status === "inProgress" && sent && next
            ? streamDelta(sent, next, event.streaming) : null;
          if (!delta) {
            subscription.wholeSeq = streamSeq;
            return { streamSeq, event };
          }
          const { streaming: _whole, ...notice } = event;
          if (Object.hasOwn(notice, "text") && notice.text === next.messages.get(notice.messageId)?.text) delete notice.text;
          return { streamSeq, event: { ...notice, streamDelta: delta } };
        }
        function publish(event, revision) {
          const part = streamPart(event);
          subscription.queue = subscription.queue.then(async () => {
            if (!current()) return;
            await events.publish({
              type: "entity.changed", source: "assistant", entity: "conversation", operation: "updated",
              entityId: input.conversationId,
              ...(actorId ? { actorId, scope: { kind: "user", id: actorId } } : {}),
              realtime: {
                audience: { room: socket.id },
                event: ASSISTANT_CONVERSATION_EVENT,
                payload: { subscriptionId, conversationId: input.conversationId,
                  streamEpoch: subscription.epoch, streamRevision: revision, ...part }
              }
            });
          }).catch(() => {}); // A notification failure cannot fail or repeat a model turn; its subscriber resyncs.
        }
        function flush() {
          clearTimeout(subscription.timer);
          subscription.timer = null;
          const pending = [...subscription.pending.values()].sort((left, right) => left.revision - right.revision);
          subscription.pending.clear();
          if (subscription.resync) {
            subscription.resync = false;
            const sent = subscription.sentStream;
            // The next stream part goes whole; with none waiting, the stream the subscriber should hold goes now.
            subscription.sentStream = null;
            if (!pending.length && sent) {
              const streaming = { revision: sent.revision, messages: [...sent.messages.values()] };
              publish({ type: "stream-resync", streaming }, ++subscription.revision);
            }
          }
          for (const { event, revision } of pending) publish(event, revision);
        }
        subscription.requestWhole = seenSeq => {
          // A whole stream sent after the part the subscriber could not apply is already on its way to it.
          if (!current() || subscription.wholeSeq > seenSeq) return;
          subscription.resync = true;
          subscription.timer ||= setTimeout(flush, 25);
        };
        function onEvent(event) {
          if (!current()) return;
          const revision = ++subscription.revision;
          // Conversation runtimes publish full-text in-progress replies; only the latest per message needs delivery.
          if (event.type === "message" && event.status === "inProgress") {
            subscription.pending.set(event.messageId, { event, revision });
            subscription.timer ||= setTimeout(flush, 25);
          } else {
            flush();
            publish(event, revision);
          }
        }
        const state = await request.executeAction({
          actionId: subscribeActionId, channel: "internal", surface: routeState.hostSurfaceId,
          input: { ...routeState.actionInput, conversationId: input.conversationId },
          deps: {
            onEvent,
            onStage,
            isCurrent: current,
            onRelease(detach) {
              if (!current()) detach();
              else subscription.release = detach;
            }
          }
        });
        if (!current()) { onStage("abandoned"); return; }
        onStage("acknowledgement", {
          ...(Array.isArray(state?.conversationLog) ? { snapshotTurns: state.conversationLog.length } : {}),
          ...(Number.isSafeInteger(state?.pagination?.limit) ? { snapshotLimit: state.pagination.limit } : {})
        });
        acknowledge({ ok: true, subscriptionId, streamEpoch: subscription.epoch, state });
        // Sending an acknowledgement does not prove that a timed-out client received it.
        onStage("acknowledgement-sent");
      } catch (thrown) {
        // A database error is acknowledged as its stand-in (a generic 409 or 500), and its detail goes to the log.
        const error = hideDatabaseError(thrown);
        if (error !== thrown) logger.error({ err: thrown }, "Assistant conversation subscription failed on a database error.");
        onStage("failed", { code: String(error?.code || "assistant_subscription_failed"),
          status: errorStatus(error) });
        if (subscriptions.get(subscriptionId) === subscription) release(subscriptionId);
        if (!closed && socket.connected) acknowledge(subscriptionError(error));
      } finally {
        clearTimeout(diagnosticTimer);
      }
    }

    function unsubscribe(input, acknowledge) {
      try {
        release(requireSubscriptionId(input));
        if (typeof acknowledge === "function") acknowledge({ ok: true });
      } catch (error) {
        if (typeof acknowledge === "function") acknowledge(subscriptionError(error));
      }
    }
    /**
     * A subscriber that missed a stream part (`streamSeq`, the part it could not apply) gets the whole stream once.
     * @param {any} input
     */
    function resync(input) {
      const subscription = typeof input?.subscriptionId === "string" ? subscriptions.get(input.subscriptionId) : undefined;
      if (!subscription?.requestWhole || input.streamEpoch !== subscription.epoch || !Number.isSafeInteger(input.streamSeq)) return;
      subscription.requestWhole(input.streamSeq);
    }
    socket.on(ASSISTANT_CONVERSATION_SUBSCRIBE, subscribe);
    socket.on(ASSISTANT_CONVERSATION_UNSUBSCRIBE, unsubscribe);
    socket.on(ASSISTANT_CONVERSATION_RESYNC, resync);
    return () => {
      closed = true;
      socket.off(ASSISTANT_CONVERSATION_SUBSCRIBE, subscribe);
      socket.off(ASSISTANT_CONVERSATION_UNSUBSCRIBE, unsubscribe);
      socket.off(ASSISTANT_CONVERSATION_RESYNC, resync);
      for (const subscriptionId of subscriptions.keys()) release(subscriptionId, "connection-closed");
    };
  });
}

export { registerConversationSubscriptions };
