import {
  createRealtimeRuntime as createRealtimeClientRuntime,
  createReconnectPolicy,
  createReplayPolicy,
  createSocketIoTransport
} from "@jskit-ai/realtime-client-runtime/client";

import { REALTIME_ERROR_CODES, REALTIME_MESSAGE_TYPES, TOPIC_SCOPES } from "@jskit-ai/realtime-contracts/client";
import { getTopicRule, getTopicScope, isTopicAllowedForSurface } from "../../../shared/topicRegistry.js";
import { API_REALTIME_PATH } from "../../../shared/apiPaths.js";
import { projectsScopeQueryKey } from "../../modules/projects/queryKeys.js";
import { getClientId } from "./clientIdentity.js";
import { commandTracker } from "./commandTracker.js";
import { createRealtimeEventHandlers } from "./realtimeEventHandlers.js";
import { composeRealtimeTopicContributions } from "../../framework/composeRealtimeClient.js";

const RECONNECT_POLICY = createReconnectPolicy({
  baseDelayMs: 800,
  maxDelayMs: 20_000,
  jitterRatio: 0.2
});

const REPLAY_POLICY = createReplayPolicy({
  maxEventsPerCommand: 80,
  maxEventsPerTick: 240
});

const MAINTENANCE_INTERVAL_MS = 750;

function normalizeSurface(surface) {
  return String(surface || "")
    .trim()
    .toLowerCase();
}

function resolveRuntimeFingerprint({ surface, authenticated, workspaceSlug, topics }) {
  const normalizedTopics = normalizeTopics(topics);
  return [
    normalizeSurface(surface),
    authenticated ? "1" : "0",
    workspaceSlug || "none",
    normalizedTopics.join(",") || "none"
  ].join(":");
}

function resolveTopicRequiredPermissions(topicRule, surfaceValue) {
  if (!topicRule || typeof topicRule !== "object") {
    return [];
  }

  const surfaceMap =
    topicRule.requiredAnyPermissionBySurface && typeof topicRule.requiredAnyPermissionBySurface === "object"
      ? topicRule.requiredAnyPermissionBySurface
      : null;
  const normalizedSurface = normalizeSurface(surfaceValue);
  if (surfaceMap && normalizedSurface) {
    const surfacedPermissions = Array.isArray(surfaceMap[normalizedSurface]) ? surfaceMap[normalizedSurface] : null;
    if (surfacedPermissions) {
      return surfacedPermissions;
    }
  }

  return Array.isArray(topicRule.requiredAnyPermission) ? topicRule.requiredAnyPermission : [];
}

function hasAnyTopicPermission({ workspaceStore, topic, surface = "" }) {
  const topicRule = getTopicRule(topic);
  if (!topicRule) {
    return false;
  }

  const requiredPermissions = resolveTopicRequiredPermissions(topicRule, surface);
  if (requiredPermissions.length < 1) {
    return true;
  }

  if (typeof workspaceStore?.can !== "function") {
    return false;
  }

  return requiredPermissions.some((permission) => workspaceStore.can(permission));
}

function resolveEligibleTopics(workspaceStore, surface) {
  const composedRealtimeTopics = composeRealtimeTopicContributions().topics;
  return composedRealtimeTopics.filter(
    (topic) => isTopicAllowedForSurface(topic, surface) && hasAnyTopicPermission({ workspaceStore, topic, surface })
  );
}

function hasUserScopedTopic(topics) {
  const normalizedTopics = normalizeTopics(topics);
  return normalizedTopics.some((topic) => getTopicScope(topic) === TOPIC_SCOPES.USER);
}

function resolveConfiguredRealtimeUrl() {
  const envObject = typeof import.meta !== "undefined" && import.meta && import.meta.env ? import.meta.env : null;
  const configured = String(envObject?.VITE_REALTIME_URL || "").trim();
  if (!configured) {
    return "";
  }

  return configured.replace(/\/+$/, "");
}

function buildRealtimeUrl() {
  const configuredRealtimeUrl = resolveConfiguredRealtimeUrl();
  if (configuredRealtimeUrl) {
    return configuredRealtimeUrl;
  }

  if (typeof window === "undefined") {
    return "";
  }

  const protocol = window.location?.protocol === "https:" ? "https:" : "http:";
  return `${protocol}//${window.location.host}`;
}

function normalizeTopics(topics) {
  const source = Array.isArray(topics) ? topics : [];
  return [...new Set(source.map((topic) => String(topic || "").trim()).filter(Boolean))].sort();
}

function sameTopics(left, right) {
  const normalizedLeft = normalizeTopics(left);
  const normalizedRight = normalizeTopics(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  for (let index = 0; index < normalizedLeft.length; index += 1) {
    if (normalizedLeft[index] !== normalizedRight[index]) {
      return false;
    }
  }

  return true;
}

async function reconcileSubscribe({ eventHandlers, queryClient, workspaceSlug, topics }) {
  if (typeof eventHandlers.reconcileTopics === "function") {
    await eventHandlers.reconcileTopics({
      workspaceSlug,
      topics
    });
    return;
  }

  await queryClient.invalidateQueries({
    queryKey: projectsScopeQueryKey(workspaceSlug)
  });
}

function onConnectionStateChange(state) {
  if (import.meta?.env?.MODE !== "development") {
    return undefined;
  }

  if (typeof console === "undefined" || typeof console.debug !== "function") {
    return undefined;
  }

  const summary = String(state?.state || "unknown");
  console.debug("[realtime-runtime]", summary, state);
  return undefined;
}

function createRealtimeRuntime({
  authStore,
  workspaceStore,
  consoleStore = null,
  queryClient,
  surface,
  socketFactory,
  onConnectionStateChange: onConnectionStateChangeHook = null
}) {
  if (!authStore || !workspaceStore || !queryClient) {
    throw new Error("authStore, workspaceStore, and queryClient are required.");
  }

  const clientId = getClientId();
  const eventHandlers = createRealtimeEventHandlers({
    queryClient,
    commandTracker,
    clientId,
    workspaceStore,
    consoleStore
  });
  const normalizedSurface = normalizeSurface(surface);

  return createRealtimeClientRuntime({
    commandTracker,
    resolveEligibility() {
      const workspaceSlug = String(workspaceStore?.activeWorkspaceSlug || "").trim();
      const authenticated = Boolean(authStore?.isAuthenticated);
      const topics = normalizeTopics(resolveEligibleTopics(workspaceStore, normalizedSurface));
      const canConnectWithoutWorkspace = hasUserScopedTopic(topics);

      return {
        eligible: Boolean(authenticated && topics.length > 0 && (workspaceSlug || canConnectWithoutWorkspace)),
        fingerprint: resolveRuntimeFingerprint({
          surface: normalizedSurface,
          authenticated,
          workspaceSlug,
          topics
        }),
        subscribePayload: {
          workspaceSlug,
          topics
        }
      };
    },
    onEvent(eventEnvelope, options = {}) {
      return eventHandlers.processEvent(eventEnvelope, options);
    },
    onEvents(eventEnvelopes, options = {}) {
      return eventHandlers.processEvents(eventEnvelopes, options);
    },
    onSubscribed({ subscribePayload }) {
      return reconcileSubscribe({
        eventHandlers,
        queryClient,
        workspaceSlug: String(subscribePayload?.workspaceSlug || "").trim(),
        topics: normalizeTopics(subscribePayload?.topics)
      });
    },
    reconnectPolicy: RECONNECT_POLICY,
    replayPolicy: REPLAY_POLICY,
    maintenanceIntervalMs: MAINTENANCE_INTERVAL_MS,
    onConnectionStateChange(nextState) {
      onConnectionStateChange(nextState);
      if (typeof onConnectionStateChangeHook !== "function") {
        return;
      }

      try {
        onConnectionStateChangeHook(nextState);
      } catch {
        // external connection-state observers are best-effort.
      }
    },
    isSubscribeAckMatch({ message, tracking }) {
      const trackedWorkspaceSlug = String(tracking?.subscribePayload?.workspaceSlug || "").trim();
      const ackWorkspaceSlug = String(message?.workspaceSlug || "").trim();
      if (ackWorkspaceSlug !== trackedWorkspaceSlug) {
        return false;
      }

      return sameTopics(message?.topics, tracking?.subscribePayload?.topics);
    },
    surface: normalizedSurface,
    buildRealtimeUrl,
    transport: createSocketIoTransport({
      socketFactory,
      path: API_REALTIME_PATH,
      transports: ["websocket"]
    }),
    messageTypes: REALTIME_MESSAGE_TYPES,
    errorCodes: REALTIME_ERROR_CODES
  });
}

const __testables = {
  resolveRuntimeFingerprint,
  buildRealtimeUrl,
  resolveConfiguredRealtimeUrl
};

export { createRealtimeRuntime, __testables };
