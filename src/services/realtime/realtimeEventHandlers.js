import { REALTIME_TOPICS } from "../../../shared/realtime/eventTypes.js";
import { projectDetailQueryKey, projectsScopeQueryKey } from "../../features/projects/queryKeys.js";
import { workspaceAdminRootQueryKey } from "../../features/workspaceAdmin/queryKeys.js";

function normalizeEventEnvelope(eventEnvelope) {
  if (!eventEnvelope || typeof eventEnvelope !== "object") {
    return null;
  }

  return {
    eventId: String(eventEnvelope.eventId || "").trim(),
    eventType: String(eventEnvelope.eventType || "").trim(),
    topic: String(eventEnvelope.topic || "").trim(),
    workspaceSlug: String(eventEnvelope.workspaceSlug || "").trim(),
    entityId: eventEnvelope.entityId == null ? "" : String(eventEnvelope.entityId),
    commandId: String(eventEnvelope.commandId || "").trim(),
    sourceClientId: String(eventEnvelope.sourceClientId || "").trim(),
    payload: eventEnvelope.payload && typeof eventEnvelope.payload === "object" ? { ...eventEnvelope.payload } : {}
  };
}

function normalizeTopics(topics) {
  const source = Array.isArray(topics) ? topics : [];
  return [...new Set(source.map((topic) => String(topic || "").trim()).filter(Boolean))];
}

async function invalidateForProjectEvent(queryClient, eventEnvelope) {
  const workspaceSlug = String(eventEnvelope.workspaceSlug || "").trim();
  await queryClient.invalidateQueries({
    queryKey: projectsScopeQueryKey(workspaceSlug)
  });

  const eventEntityId = String(eventEnvelope.entityId || "").trim();
  const payloadProjectId = eventEnvelope.payload?.projectId == null ? "" : String(eventEnvelope.payload.projectId).trim();
  const projectId = eventEntityId || payloadProjectId;

  if (!projectId || projectId === "none") {
    return;
  }

  await queryClient.invalidateQueries({
    queryKey: projectDetailQueryKey(workspaceSlug, String(projectId))
  });
}

async function invalidateForWorkspaceAdminEvent(queryClient) {
  await queryClient.invalidateQueries({
    queryKey: workspaceAdminRootQueryKey()
  });
}

async function refreshWorkspaceBootstrap(workspaceStore) {
  if (!workspaceStore || typeof workspaceStore.refreshBootstrap !== "function") {
    return;
  }

  try {
    await workspaceStore.refreshBootstrap();
  } catch {
    // bootstrap refresh is best-effort for realtime fanout.
  }
}

function resolveTopicStrategy(topic) {
  if (topic === REALTIME_TOPICS.PROJECTS) {
    return {
      invalidate: invalidateForProjectEvent,
      refreshBootstrap: false
    };
  }
  if (topic === REALTIME_TOPICS.WORKSPACE_SETTINGS) {
    return {
      invalidate: invalidateForWorkspaceAdminEvent,
      refreshBootstrap: true
    };
  }
  if (topic === REALTIME_TOPICS.WORKSPACE_MEMBERS) {
    return {
      invalidate: invalidateForWorkspaceAdminEvent,
      refreshBootstrap: true
    };
  }
  if (topic === REALTIME_TOPICS.WORKSPACE_INVITES) {
    return {
      invalidate: invalidateForWorkspaceAdminEvent,
      refreshBootstrap: false
    };
  }

  return null;
}

function createRealtimeEventHandlers({ queryClient, commandTracker, clientId, workspaceStore = null }) {
  if (!queryClient || typeof queryClient.invalidateQueries !== "function") {
    throw new Error("queryClient is required.");
  }
  if (!commandTracker || typeof commandTracker.getCommandState !== "function") {
    throw new Error("commandTracker is required.");
  }

  const normalizedClientId = String(clientId || "").trim();

  async function processEvent(eventEnvelope, options = {}) {
    const normalizedEvent = normalizeEventEnvelope(eventEnvelope);
    if (!normalizedEvent) {
      return {
        status: "ignored"
      };
    }

    const allowDeferral = options.allowDeferral !== false;
    const commandId = normalizedEvent.commandId;
    const isSelfEvent = Boolean(normalizedClientId && normalizedEvent.sourceClientId === normalizedClientId);

    if (isSelfEvent && commandId) {
      const commandState = commandTracker.getCommandState(commandId);

      if (commandState === "pending" && allowDeferral) {
        commandTracker.deferSelfEvent(normalizedEvent);
        return {
          status: "deferred"
        };
      }

      if (commandState === "acked") {
        if (normalizedEvent.eventId && commandTracker.markEventSeenAndCheckDuplicate(normalizedEvent.eventId)) {
          return {
            status: "duplicate"
          };
        }

        return {
          status: "self_acked_skipped"
        };
      }
    }

    if (normalizedEvent.eventId && commandTracker.markEventSeenAndCheckDuplicate(normalizedEvent.eventId)) {
      return {
        status: "duplicate"
      };
    }

    const topicStrategy = resolveTopicStrategy(normalizedEvent.topic);
    if (!topicStrategy) {
      return {
        status: "ignored_topic"
      };
    }

    await topicStrategy.invalidate(queryClient, normalizedEvent);
    if (topicStrategy.refreshBootstrap) {
      await refreshWorkspaceBootstrap(workspaceStore);
    }

    return {
      status: "processed"
    };
  }

  async function processEvents(eventEnvelopes, options = {}) {
    const source = Array.isArray(eventEnvelopes) ? eventEnvelopes : [];
    const maxEvents = Number.isInteger(options.maxEvents) && options.maxEvents > 0 ? options.maxEvents : source.length;
    const processed = [];

    for (let index = 0; index < source.length && index < maxEvents; index += 1) {
      processed.push(await processEvent(source[index], options));
    }

    return processed;
  }

  async function reconcileTopics({ workspaceSlug, topics } = {}) {
    const normalizedWorkspaceSlug = String(workspaceSlug || "").trim();
    const normalizedTopics = normalizeTopics(topics);
    let shouldRefreshBootstrap = false;

    for (const topic of normalizedTopics) {
      const topicStrategy = resolveTopicStrategy(topic);
      if (!topicStrategy) {
        continue;
      }

      await topicStrategy.invalidate(queryClient, {
        workspaceSlug: normalizedWorkspaceSlug,
        entityId: "",
        payload: {}
      });
      shouldRefreshBootstrap = shouldRefreshBootstrap || topicStrategy.refreshBootstrap;
    }

    if (shouldRefreshBootstrap) {
      await refreshWorkspaceBootstrap(workspaceStore);
    }
  }

  return {
    processEvent,
    processEvents,
    reconcileTopics
  };
}

const __testables = {
  normalizeEventEnvelope,
  invalidateForProjectEvent
};

export { createRealtimeEventHandlers, __testables };
