import { beforeEach, describe, expect, it, vi } from "vitest";
import { REALTIME_TOPICS } from "../../shared/realtime/eventTypes.js";
import {
  workspaceAiTranscriptsRootQueryKey,
  workspaceAiTranscriptsScopeQueryKey
} from "../../src/features/aiTranscripts/queryKeys.js";
import { projectDetailQueryKey, projectsScopeQueryKey } from "../../src/features/projects/queryKeys.js";
import {
  workspaceAdminRootQueryKey,
  workspaceBillingLimitationsQueryKey,
  workspaceBillingPlanStateQueryKey,
  workspaceBillingPurchasesQueryKey
} from "../../src/features/workspaceAdmin/queryKeys.js";
import { commandTracker, __testables as trackerTestables } from "../../src/services/realtime/commandTracker.js";
import { createRealtimeEventHandlers } from "../../src/services/realtime/realtimeEventHandlers.js";

describe("realtimeEventHandlers", () => {
  const queryClient = {
    invalidateQueries: vi.fn()
  };

  beforeEach(() => {
    commandTracker.resetForTests();
    queryClient.invalidateQueries.mockReset();
    queryClient.invalidateQueries.mockResolvedValue(undefined);
  });

  it("drops duplicate events by eventId", async () => {
    const handlers = createRealtimeEventHandlers({
      queryClient,
      commandTracker,
      clientId: "cli-local"
    });

    const event = {
      eventId: "evt-1",
      topic: REALTIME_TOPICS.PROJECTS,
      workspaceSlug: "acme",
      entityId: "15",
      sourceClientId: "cli-remote"
    };

    expect((await handlers.processEvent(event)).status).toBe("processed");
    expect((await handlers.processEvent(event)).status).toBe("duplicate");
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it("skips heavy invalidation for self events tied to acked commands", async () => {
    const handlers = createRealtimeEventHandlers({
      queryClient,
      commandTracker,
      clientId: "cli-local"
    });

    commandTracker.markCommandPending("cmd-acked");
    commandTracker.markCommandAcked("cmd-acked");

    const event = {
      eventId: "evt-self-acked",
      topic: REALTIME_TOPICS.PROJECTS,
      workspaceSlug: "acme",
      commandId: "cmd-acked",
      sourceClientId: "cli-local",
      entityId: "10"
    };

    expect((await handlers.processEvent(event)).status).toBe("self_acked_skipped");
    expect((await handlers.processEvent(event)).status).toBe("duplicate");
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });

  it("defers self events while command is pending without marking event as seen", async () => {
    const handlers = createRealtimeEventHandlers({
      queryClient,
      commandTracker,
      clientId: "cli-local"
    });

    commandTracker.markCommandPending("cmd-pending");

    const event = {
      eventId: "evt-self-pending",
      topic: REALTIME_TOPICS.PROJECTS,
      workspaceSlug: "acme",
      commandId: "cmd-pending",
      sourceClientId: "cli-local",
      entityId: "11"
    };

    expect((await handlers.processEvent(event)).status).toBe("deferred");
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(commandTracker.drainDeferredEventsForCommand("cmd-pending", "failed")).toHaveLength(1);
    expect(trackerTestables.seenEventIds.has("evt-self-pending")).toBe(false);
  });

  it("processes self events normally when command is failed", async () => {
    const handlers = createRealtimeEventHandlers({
      queryClient,
      commandTracker,
      clientId: "cli-local"
    });

    commandTracker.markCommandPending("cmd-failed");
    commandTracker.markCommandFailed("cmd-failed", "network");

    const event = {
      eventId: "evt-self-failed",
      topic: REALTIME_TOPICS.PROJECTS,
      workspaceSlug: "acme",
      commandId: "cmd-failed",
      sourceClientId: "cli-local",
      entityId: 12
    };

    expect((await handlers.processEvent(event)).status).toBe("processed");
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it("invalidates expected query keys and normalizes entity id to string", async () => {
    const handlers = createRealtimeEventHandlers({
      queryClient,
      commandTracker,
      clientId: "cli-local"
    });

    const event = {
      eventId: "evt-keys",
      topic: REALTIME_TOPICS.PROJECTS,
      workspaceSlug: "acme",
      sourceClientId: "cli-remote",
      entityId: 123
    };

    const result = await handlers.processEvent(event);
    expect(result.status).toBe("processed");

    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: projectsScopeQueryKey("acme")
    });
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: projectDetailQueryKey("acme", "123")
    });
  });

  it("invalidates workspace admin scope and refreshes bootstrap for workspace settings events", async () => {
    const workspaceStore = {
      refreshBootstrap: vi.fn().mockResolvedValue(undefined)
    };
    const handlers = createRealtimeEventHandlers({
      queryClient,
      commandTracker,
      clientId: "cli-local",
      workspaceStore
    });

    const event = {
      eventId: "evt-workspace-settings",
      topic: REALTIME_TOPICS.WORKSPACE_SETTINGS,
      workspaceSlug: "acme",
      sourceClientId: "cli-remote",
      entityId: "11"
    };

    const result = await handlers.processEvent(event);
    expect(result.status).toBe("processed");

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: workspaceAdminRootQueryKey()
    });
    expect(workspaceStore.refreshBootstrap).toHaveBeenCalledTimes(1);
  });

  it("refreshes bootstrap for workspace meta events without heavy invalidation", async () => {
    const workspaceStore = {
      refreshBootstrap: vi.fn().mockResolvedValue(undefined)
    };
    const handlers = createRealtimeEventHandlers({
      queryClient,
      commandTracker,
      clientId: "cli-local",
      workspaceStore
    });

    const event = {
      eventId: "evt-workspace-meta",
      topic: REALTIME_TOPICS.WORKSPACE_META,
      workspaceSlug: "acme",
      sourceClientId: "cli-remote",
      entityId: "11"
    };

    const result = await handlers.processEvent(event);
    expect(result.status).toBe("processed");
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(workspaceStore.refreshBootstrap).toHaveBeenCalledTimes(1);
  });

  it("invalidates workspace transcript scope when transcript topic has workspace slug", async () => {
    const handlers = createRealtimeEventHandlers({
      queryClient,
      commandTracker,
      clientId: "cli-local"
    });

    const event = {
      eventId: "evt-transcripts-scope",
      topic: REALTIME_TOPICS.WORKSPACE_AI_TRANSCRIPTS,
      workspaceSlug: "acme",
      sourceClientId: "cli-remote",
      entityId: "99"
    };

    const result = await handlers.processEvent(event);
    expect(result.status).toBe("processed");
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: workspaceAiTranscriptsScopeQueryKey("acme")
    });
  });

  it("invalidates transcript root when transcript topic omits workspace slug", async () => {
    const handlers = createRealtimeEventHandlers({
      queryClient,
      commandTracker,
      clientId: "cli-local"
    });

    const event = {
      eventId: "evt-transcripts-root",
      topic: REALTIME_TOPICS.WORKSPACE_AI_TRANSCRIPTS,
      workspaceSlug: "",
      sourceClientId: "cli-remote",
      entityId: "99"
    };

    const result = await handlers.processEvent(event);
    expect(result.status).toBe("processed");
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: workspaceAiTranscriptsRootQueryKey()
    });
  });

  it("invalidates limitations for billing-limit events", async () => {
    const handlers = createRealtimeEventHandlers({
      queryClient,
      commandTracker,
      clientId: "cli-local"
    });

    const event = {
      eventId: "evt-billing-limits",
      topic: REALTIME_TOPICS.WORKSPACE_BILLING_LIMITS,
      workspaceSlug: "acme",
      sourceClientId: "cli-remote",
      payload: {
        changeSource: "manual_refresh"
      }
    };

    const result = await handlers.processEvent(event);
    expect(result.status).toBe("processed");
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: workspaceBillingLimitationsQueryKey("acme")
    });
  });

  it("invalidates plan state and purchases on purchase grants", async () => {
    const handlers = createRealtimeEventHandlers({
      queryClient,
      commandTracker,
      clientId: "cli-local"
    });

    const event = {
      eventId: "evt-billing-purchase-grant",
      topic: REALTIME_TOPICS.WORKSPACE_BILLING_LIMITS,
      workspaceSlug: "acme",
      sourceClientId: "cli-remote",
      payload: {
        changeSource: "purchase_grant"
      }
    };

    const result = await handlers.processEvent(event);
    expect(result.status).toBe("processed");
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(3);
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: workspaceBillingLimitationsQueryKey("acme")
    });
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: workspaceBillingPlanStateQueryKey("acme")
    });
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(3, {
      queryKey: workspaceBillingPurchasesQueryKey("acme")
    });
  });

  it("invalidates plan state but not purchases on plan grants", async () => {
    const handlers = createRealtimeEventHandlers({
      queryClient,
      commandTracker,
      clientId: "cli-local"
    });

    const event = {
      eventId: "evt-billing-plan-grant",
      topic: REALTIME_TOPICS.WORKSPACE_BILLING_LIMITS,
      workspaceSlug: "acme",
      sourceClientId: "cli-remote",
      payload: {
        changeSource: "plan_grant"
      }
    };

    const result = await handlers.processEvent(event);
    expect(result.status).toBe("processed");
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: workspaceBillingLimitationsQueryKey("acme")
    });
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: workspaceBillingPlanStateQueryKey("acme")
    });
  });
});
