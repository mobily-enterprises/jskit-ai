import { beforeEach, describe, expect, it } from "vitest";
import { commandTracker, __testables } from "../../src/services/realtime/commandTracker.js";

describe("commandTracker", () => {
  beforeEach(() => {
    commandTracker.resetForTests();
  });

  it("tracks pending to acked and pending to failed transitions once", () => {
    expect(commandTracker.markCommandPending("cmd-1")).toBe(true);
    expect(commandTracker.getCommandState("cmd-1")).toBe("pending");

    expect(commandTracker.markCommandAcked("cmd-1")).toBe(true);
    expect(commandTracker.getCommandState("cmd-1")).toBe("acked");
    expect(commandTracker.markCommandFailed("cmd-1", "late-fail")).toBe(false);

    expect(commandTracker.markCommandPending("cmd-2")).toBe(true);
    expect(commandTracker.markCommandFailed("cmd-2", "network")).toBe(true);
    expect(commandTracker.getCommandState("cmd-2")).toBe("failed");
    expect(commandTracker.markCommandAcked("cmd-2")).toBe(false);
  });

  it("marks events as seen and drops duplicates", () => {
    expect(commandTracker.markEventSeenAndCheckDuplicate("evt-1")).toBe(false);
    expect(commandTracker.markEventSeenAndCheckDuplicate("evt-1")).toBe(true);
    expect(commandTracker.markEventSeenAndCheckDuplicate("")).toBe(false);
  });

  it("defers and drains self events per command", () => {
    const event = {
      eventId: "evt-10",
      commandId: "cmd-10",
      workspaceSlug: "acme",
      entityId: "123"
    };

    expect(commandTracker.deferSelfEvent(event)).toBe(true);
    expect(commandTracker.deferSelfEvent(event)).toBe(false);

    const drained = commandTracker.drainDeferredEventsForCommand("cmd-10", "failed");
    expect(drained).toHaveLength(1);
    expect(drained[0].eventId).toBe("evt-10");

    expect(commandTracker.drainDeferredEventsForCommand("cmd-10", "again")).toEqual([]);
  });

  it("prunes expired entries from all tracker maps", () => {
    commandTracker.markCommandPending("cmd-pending");
    commandTracker.markCommandPending("cmd-acked");
    commandTracker.markCommandAcked("cmd-acked");
    commandTracker.markCommandPending("cmd-failed");
    commandTracker.markCommandFailed("cmd-failed", "error");
    commandTracker.markEventSeenAndCheckDuplicate("evt-exp");
    commandTracker.deferSelfEvent({ eventId: "evt-deferred", commandId: "cmd-deferred" });

    for (const entry of __testables.pendingCommandIds.values()) {
      entry.expiresAt = 0;
    }
    for (const entry of __testables.ackedCommandIds.values()) {
      entry.expiresAt = 0;
    }
    for (const entry of __testables.failedCommandIds.values()) {
      entry.expiresAt = 0;
    }
    for (const eventId of __testables.seenEventIds.keys()) {
      __testables.seenEventIds.set(eventId, 0);
    }
    for (const entry of __testables.deferredSelfEventsByCommandId.values()) {
      entry.expiresAt = 0;
    }

    commandTracker.pruneExpired(Date.now());

    expect(__testables.pendingCommandIds.size).toBe(1);
    expect(__testables.ackedCommandIds.size).toBe(0);
    expect(__testables.failedCommandIds.size).toBe(0);
    expect(__testables.seenEventIds.size).toBe(0);
    expect(__testables.deferredSelfEventsByCommandId.size).toBe(0);
  });

  it("collects expired pending commands", () => {
    commandTracker.markCommandPending("cmd-a");
    commandTracker.markCommandPending("cmd-b");

    __testables.pendingCommandIds.get("cmd-a").expiresAt = 1;
    __testables.pendingCommandIds.get("cmd-b").expiresAt = Date.now() + 99999;

    const expired = commandTracker.collectExpiredPendingCommands(Date.now());
    expect(expired).toEqual(["cmd-a"]);
    expect(commandTracker.getCommandState("cmd-a")).toBe("pending");
    expect(commandTracker.getCommandState("cmd-b")).toBe("pending");
    expect(commandTracker.markCommandFailed("cmd-a", "expired")).toBe(true);
    expect(commandTracker.getCommandState("cmd-a")).toBe("failed");
  });

  it("prunes oversized deferred queues", () => {
    for (let index = 0; index < 60; index += 1) {
      commandTracker.deferSelfEvent({
        eventId: `evt-${index}`,
        commandId: "cmd-cap"
      });
    }

    const drained = commandTracker.drainDeferredEventsForCommand("cmd-cap", "capacity");
    expect(drained.length).toBeLessThanOrEqual(__testables.MAX_DEFERRED_EVENTS_PER_COMMAND);
  });
});
