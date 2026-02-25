import { REALTIME_TOPICS } from "../../../shared/eventTypes.js";
import {
  assistantRootQueryKey,
  assistantWorkspaceScopeQueryKey,
  workspaceAiTranscriptsRootQueryKey,
  workspaceAiTranscriptsScopeQueryKey
} from "@jskit-ai/assistant-contracts";
import { chatRootQueryKey, chatScopeQueryKey } from "@jskit-ai/chat-contracts";
import { projectDetailQueryKey, projectsScopeQueryKey } from "../../modules/projects/queryKeys.js";
import {
  workspaceAdminRootQueryKey,
  workspaceBillingLimitationsQueryKey,
  workspaceBillingPlanStateQueryKey,
  workspaceBillingPurchasesQueryKey
} from "../../modules/workspaceAdmin/queryKeys.js";
import { socialRootQueryKey, socialScopeQueryKey } from "@jskit-ai/social-contracts";
import { publishRealtimeEvent } from "./realtimeEventBus.js";

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

function normalizeWorkspaceSlugFromEvent(eventEnvelope) {
  return String(eventEnvelope?.workspaceSlug || "").trim();
}

function normalizeBillingLimitChangeSource(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

const SETTINGS_QUERY_KEY = Object.freeze(["settings"]);
const HISTORY_QUERY_KEY_PREFIX = Object.freeze(["history"]);
const CONSOLE_SETTINGS_QUERY_KEY = Object.freeze(["console-settings"]);
const CONSOLE_MEMBERS_QUERY_KEY = Object.freeze(["console-members"]);
const CONSOLE_INVITES_QUERY_KEY = Object.freeze(["console-invites"]);
const CONSOLE_BILLING_PLANS_QUERY_KEY = Object.freeze(["console-billing-plans"]);
const CONSOLE_BILLING_PRODUCTS_QUERY_KEY = Object.freeze(["console-billing-products"]);
const CONSOLE_BILLING_PROVIDER_PRICES_QUERY_KEY = Object.freeze(["console-billing-provider-prices"]);
const CONSOLE_BILLING_SETTINGS_QUERY_KEY = Object.freeze(["console-billing-settings"]);
const CONSOLE_BILLING_EVENTS_QUERY_KEY = Object.freeze(["console-billing-events"]);
const CONSOLE_BILLING_SFC_ROOT_QUERY_KEY = Object.freeze(["console", "billing"]);
const CONSOLE_BROWSER_ERRORS_QUERY_KEY = Object.freeze(["console-browser-errors"]);
const CONSOLE_SERVER_ERRORS_QUERY_KEY = Object.freeze(["console-server-errors"]);

function createStaticQueryInvalidator({ queryKey }) {
  return async function invalidateByStaticQuery(queryClient) {
    const resolvedQueryKey = typeof queryKey === "function" ? queryKey() : queryKey;
    await queryClient.invalidateQueries({
      queryKey: resolvedQueryKey
    });
  };
}

function createWorkspaceScopeInvalidator({ rootQueryKey, scopeQueryKey }) {
  return async function invalidateByWorkspaceScope(queryClient, eventEnvelope) {
    const workspaceSlug = normalizeWorkspaceSlugFromEvent(eventEnvelope);
    let resolvedQueryKey = rootQueryKey;
    if (workspaceSlug) {
      resolvedQueryKey = scopeQueryKey(workspaceSlug);
    } else if (typeof rootQueryKey === "function") {
      resolvedQueryKey = rootQueryKey();
    }

    await queryClient.invalidateQueries({
      queryKey: resolvedQueryKey
    });
  };
}

async function invalidateForProjectEvent(queryClient, eventEnvelope) {
  const workspaceSlug = normalizeWorkspaceSlugFromEvent(eventEnvelope);
  await queryClient.invalidateQueries({
    queryKey: projectsScopeQueryKey(workspaceSlug)
  });

  const eventEntityId = String(eventEnvelope.entityId || "").trim();
  const payloadProjectId =
    eventEnvelope.payload?.projectId == null ? "" : String(eventEnvelope.payload.projectId).trim();
  const projectId = eventEntityId || payloadProjectId;

  if (!projectId || projectId === "none") {
    return;
  }

  await queryClient.invalidateQueries({
    queryKey: projectDetailQueryKey(workspaceSlug, String(projectId))
  });
}

async function invalidateForWorkspaceBillingLimitsEvent(queryClient, eventEnvelope) {
  const workspaceSlug = normalizeWorkspaceSlugFromEvent(eventEnvelope);
  const changeSource = normalizeBillingLimitChangeSource(eventEnvelope?.payload?.changeSource);

  await queryClient.invalidateQueries({
    queryKey: workspaceBillingLimitationsQueryKey(workspaceSlug)
  });

  if (changeSource === "purchase_grant" || changeSource === "plan_grant") {
    await queryClient.invalidateQueries({
      queryKey: workspaceBillingPlanStateQueryKey(workspaceSlug)
    });
  }

  if (changeSource === "purchase_grant") {
    await queryClient.invalidateQueries({
      queryKey: workspaceBillingPurchasesQueryKey(workspaceSlug)
    });
  }
}

const invalidateForWorkspaceAdminEvent = createStaticQueryInvalidator({
  queryKey: workspaceAdminRootQueryKey
});

const invalidateForSettingsEvent = createStaticQueryInvalidator({
  queryKey: SETTINGS_QUERY_KEY
});

async function invalidateForHistoryEvent(queryClient, eventEnvelope) {
  const workspaceSlug = normalizeWorkspaceSlugFromEvent(eventEnvelope);
  await queryClient.invalidateQueries({
    queryKey: workspaceSlug ? [...HISTORY_QUERY_KEY_PREFIX, workspaceSlug] : HISTORY_QUERY_KEY_PREFIX
  });
}

async function invalidateForWorkspaceAiTranscriptsEvent(queryClient, eventEnvelope) {
  const workspaceSlug = normalizeWorkspaceSlugFromEvent(eventEnvelope);

  await queryClient.invalidateQueries({
    queryKey: workspaceSlug ? workspaceAiTranscriptsScopeQueryKey(workspaceSlug) : workspaceAiTranscriptsRootQueryKey()
  });

  await queryClient.invalidateQueries({
    queryKey: workspaceSlug
      ? assistantWorkspaceScopeQueryKey({
          workspaceSlug
        })
      : assistantRootQueryKey()
  });
}

const invalidateForChatEvent = createWorkspaceScopeInvalidator({
  rootQueryKey: chatRootQueryKey,
  scopeQueryKey: chatScopeQueryKey
});

async function invalidateForConsoleMembersEvent(queryClient) {
  await queryClient.invalidateQueries({
    queryKey: CONSOLE_MEMBERS_QUERY_KEY
  });
}

async function invalidateForConsoleSettingsEvent(queryClient) {
  await queryClient.invalidateQueries({
    queryKey: CONSOLE_SETTINGS_QUERY_KEY
  });
}

async function invalidateForConsoleInvitesEvent(queryClient) {
  await queryClient.invalidateQueries({
    queryKey: CONSOLE_INVITES_QUERY_KEY
  });
}

async function invalidateForConsoleBillingEvent(queryClient) {
  const queryKeys = [
    CONSOLE_BILLING_PLANS_QUERY_KEY,
    CONSOLE_BILLING_PRODUCTS_QUERY_KEY,
    CONSOLE_BILLING_PROVIDER_PRICES_QUERY_KEY,
    CONSOLE_BILLING_SETTINGS_QUERY_KEY,
    CONSOLE_BILLING_EVENTS_QUERY_KEY,
    CONSOLE_BILLING_SFC_ROOT_QUERY_KEY
  ];

  for (const queryKey of queryKeys) {
    await queryClient.invalidateQueries({
      queryKey
    });
  }
}

async function invalidateForConsoleErrorsEvent(queryClient) {
  await queryClient.invalidateQueries({
    queryKey: CONSOLE_BROWSER_ERRORS_QUERY_KEY
  });
  await queryClient.invalidateQueries({
    queryKey: CONSOLE_SERVER_ERRORS_QUERY_KEY
  });
}

const invalidateForSocialFeedEvent = createWorkspaceScopeInvalidator({
  rootQueryKey: socialRootQueryKey,
  scopeQueryKey: socialScopeQueryKey
});

const invalidateForSocialNotificationsEvent = createWorkspaceScopeInvalidator({
  rootQueryKey: socialRootQueryKey,
  scopeQueryKey: socialScopeQueryKey
});

async function invalidateNoop() {
  return undefined;
}

// New topics are typically one strategy entry plus a query-key invalidator helper.
const TOPIC_STRATEGY_REGISTRY = Object.freeze({
  [REALTIME_TOPICS.ALERTS]: Object.freeze({
    invalidate: invalidateNoop,
    refreshBootstrap: false
  }),
  [REALTIME_TOPICS.SETTINGS]: Object.freeze({
    invalidate: invalidateForSettingsEvent,
    refreshBootstrap: false
  }),
  [REALTIME_TOPICS.HISTORY]: Object.freeze({
    invalidate: invalidateForHistoryEvent,
    refreshBootstrap: false
  }),
  [REALTIME_TOPICS.PROJECTS]: Object.freeze({
    invalidate: invalidateForProjectEvent,
    refreshBootstrap: false
  }),
  [REALTIME_TOPICS.WORKSPACE_SETTINGS]: Object.freeze({
    invalidate: invalidateForWorkspaceAdminEvent,
    refreshBootstrap: true
  }),
  [REALTIME_TOPICS.WORKSPACE_META]: Object.freeze({
    invalidate: invalidateNoop,
    refreshBootstrap: true
  }),
  [REALTIME_TOPICS.WORKSPACE_MEMBERS]: Object.freeze({
    invalidate: invalidateForWorkspaceAdminEvent,
    refreshBootstrap: true
  }),
  [REALTIME_TOPICS.WORKSPACE_INVITES]: Object.freeze({
    invalidate: invalidateForWorkspaceAdminEvent,
    refreshBootstrap: false
  }),
  [REALTIME_TOPICS.WORKSPACE_AI_TRANSCRIPTS]: Object.freeze({
    invalidate: invalidateForWorkspaceAiTranscriptsEvent,
    refreshBootstrap: false
  }),
  [REALTIME_TOPICS.WORKSPACE_BILLING_LIMITS]: Object.freeze({
    invalidate: invalidateForWorkspaceBillingLimitsEvent,
    refreshBootstrap: false
  }),
  [REALTIME_TOPICS.CONSOLE_MEMBERS]: Object.freeze({
    invalidate: invalidateForConsoleMembersEvent,
    refreshBootstrap: false,
    refreshConsoleBootstrap: true
  }),
  [REALTIME_TOPICS.CONSOLE_SETTINGS]: Object.freeze({
    invalidate: invalidateForConsoleSettingsEvent,
    refreshBootstrap: false,
    refreshConsoleBootstrap: false
  }),
  [REALTIME_TOPICS.CONSOLE_INVITES]: Object.freeze({
    invalidate: invalidateForConsoleInvitesEvent,
    refreshBootstrap: false,
    refreshConsoleBootstrap: true
  }),
  [REALTIME_TOPICS.CONSOLE_BILLING]: Object.freeze({
    invalidate: invalidateForConsoleBillingEvent,
    refreshBootstrap: false,
    refreshConsoleBootstrap: false
  }),
  [REALTIME_TOPICS.CONSOLE_ERRORS]: Object.freeze({
    invalidate: invalidateForConsoleErrorsEvent,
    refreshBootstrap: false,
    refreshConsoleBootstrap: false
  }),
  [REALTIME_TOPICS.CHAT]: Object.freeze({
    invalidate: invalidateForChatEvent,
    refreshBootstrap: false
  }),
  [REALTIME_TOPICS.TYPING]: Object.freeze({
    invalidate: invalidateNoop,
    refreshBootstrap: false
  }),
  [REALTIME_TOPICS.SOCIAL_FEED]: Object.freeze({
    invalidate: invalidateForSocialFeedEvent,
    refreshBootstrap: false
  }),
  [REALTIME_TOPICS.SOCIAL_NOTIFICATIONS]: Object.freeze({
    invalidate: invalidateForSocialNotificationsEvent,
    refreshBootstrap: false
  })
});

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

async function refreshConsoleBootstrap(consoleStore) {
  if (!consoleStore || typeof consoleStore.refreshBootstrap !== "function") {
    return;
  }

  try {
    await consoleStore.refreshBootstrap();
  } catch {
    // console bootstrap refresh is best-effort for realtime fanout.
  }
}

function resolveTopicStrategy(topic) {
  const normalizedTopic = String(topic || "").trim();
  if (!normalizedTopic) {
    return null;
  }

  return TOPIC_STRATEGY_REGISTRY[normalizedTopic] || null;
}

function createRealtimeEventHandlers({ queryClient, commandTracker, clientId, workspaceStore = null, consoleStore = null }) {
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

    publishRealtimeEvent(normalizedEvent);

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
    if (topicStrategy.refreshConsoleBootstrap) {
      await refreshConsoleBootstrap(consoleStore);
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
    let shouldRefreshConsoleBootstrap = false;

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
      shouldRefreshConsoleBootstrap = shouldRefreshConsoleBootstrap || topicStrategy.refreshConsoleBootstrap;
    }

    if (shouldRefreshBootstrap) {
      await refreshWorkspaceBootstrap(workspaceStore);
    }
    if (shouldRefreshConsoleBootstrap) {
      await refreshConsoleBootstrap(consoleStore);
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
  invalidateForProjectEvent,
  invalidateForWorkspaceBillingLimitsEvent
};

export { createRealtimeEventHandlers, __testables };
