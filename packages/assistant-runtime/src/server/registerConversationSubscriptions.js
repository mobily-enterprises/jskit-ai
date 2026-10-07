import { randomUUID } from "node:crypto";
import { attachDirectRequestActionExecutor } from "@jskit-ai/kernel/server/http";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { actionIds } from "./actionIds.js";
import { resolveRouteRequestState } from "./support/assistantRouteContext.js";
import { resolveAssistantSurfaceConfig } from "../shared/assistantSurfaces.js";
import {
  ASSISTANT_CONVERSATION_EVENT,
  ASSISTANT_CONVERSATION_SUBSCRIBE,
  ASSISTANT_CONVERSATION_UNSUBSCRIBE
} from "../shared/conversationRealtime.js";

function requireSubscriptionId(input) {
  if (typeof input?.subscriptionId !== "string" || !input.subscriptionId.trim() || input.subscriptionId.length > 128) {
    throw new AppError(400, "A conversation subscription id is required.");
  }
  return input.subscriptionId;
}

function subscriptionError(error) {
  const status = Number(error?.status || error?.statusCode || 500);
  return {
    ok: false,
    error: status < 500 ? String(error.message || "Conversation subscription failed.") : "Conversation subscription failed.",
    code: String(error?.code || "assistant_subscription_failed"),
    status
  };
}

// Register one conversation subscription owner per shared realtime runtime.
// A host may select its fixed action/request policy at composition; clients
// never choose either. The selected action remains the authorization boundary.
function registerConversationSubscriptions({ realtime, events, actions, config = {}, logger = null, workspaceScopeSupport = null,
  subscribeActionId = actionIds.conversationSubscribe, requestPolicy = "authenticated" } = {}) {
  if (typeof realtime?.onConnection !== "function" || typeof events?.publish !== "function") {
    throw new TypeError("Conversation subscriptions require the shared realtime connection and event runtime.");
  }
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

    function release(subscriptionId) {
      const subscription = subscriptions.get(subscriptionId);
      if (!subscription) return;
      subscriptions.delete(subscriptionId);
      clearTimeout(subscription.timer);
      subscription.pending.clear();
      subscription.release?.();
    }

    async function subscribe(input, acknowledge) {
      if (typeof acknowledge !== "function" || closed) return;
      let subscription;
      let subscriptionId;
      const startedAt = performance.now();
      let stageStartedAt = startedAt;
      let stage = "request-admission";
      let observedConversationId;
      function onStage(next, fields = {}) {
        const now = performance.now();
        // Only a successfully opened, authorized conversation may enter diagnostics.
        if (next === "observer-attach") observedConversationId = input.conversationId;
        try {
          logger?.info?.({ event: "assistant.conversation.subscription", subscriptionEpoch: subscription?.epoch,
            ...(typeof observedConversationId === "string" ? { conversationId: observedConversationId } : {}),
            stage: next, previousStage: stage,
            durationMs: now - stageStartedAt, elapsedMs: now - startedAt, ...fields },
          "Assistant conversation subscription stage");
        } catch { /* Diagnostics must not change conversation admission or cleanup. */ }
        stage = next;
        stageStartedAt = now;
      }
      try {
        subscriptionId = requireSubscriptionId(input);
        release(subscriptionId);
        subscription = { pending: new Map(), revision: 0, epoch: randomUUID(), queue: Promise.resolve() };
        subscriptions.set(subscriptionId, subscription);
        const current = () => !closed && socket.connected && subscriptions.get(subscriptionId) === subscription;
        onStage("authentication");
        const request = await (requestPolicy === "host" ? readRequest() : authenticate());
        if (!current()) { onStage("abandoned"); return; }
        onStage("action-admission");
        const assistantSurface = resolveAssistantSurfaceConfig(config, input.targetSurfaceId);
        if (!assistantSurface) throw new AppError(404, "Assistant not found.");
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
        const actorId = request.user?.id;

        function publish(event, revision) {
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
                  streamEpoch: subscription.epoch, streamRevision: revision, event }
              }
            });
          }).catch(() => {}); // A notification failure cannot fail or repeat a model turn.
        }
        function flush() {
          clearTimeout(subscription.timer);
          subscription.timer = null;
          for (const pending of [...subscription.pending.values()].sort((left, right) => left.revision - right.revision)) {
            publish(pending.event, pending.revision);
          }
          subscription.pending.clear();
        }
        function onEvent(event) {
          if (!current()) return;
          const revision = ++subscription.revision;
          // The Colleague publisher already coalesces transient full-text replies.
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
      } catch (error) {
        onStage("failed", { code: String(error?.code || "assistant_subscription_failed"),
          status: Number(error?.status || error?.statusCode || 500) });
        if (subscriptions.get(subscriptionId) === subscription) release(subscriptionId);
        if (!closed && socket.connected) acknowledge(subscriptionError(error));
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
    socket.on(ASSISTANT_CONVERSATION_SUBSCRIBE, subscribe);
    socket.on(ASSISTANT_CONVERSATION_UNSUBSCRIBE, unsubscribe);
    return () => {
      closed = true;
      socket.off(ASSISTANT_CONVERSATION_SUBSCRIBE, subscribe);
      socket.off(ASSISTANT_CONVERSATION_UNSUBSCRIBE, unsubscribe);
      for (const subscriptionId of subscriptions.keys()) release(subscriptionId);
    };
  });
}

export { registerConversationSubscriptions };
