import assert from "node:assert/strict";
import test from "node:test";

import { createCommandTracker } from "../src/index.js";

test("command tracker transitions pending commands to acked or failed once", () => {
  const tracker = createCommandTracker();

  assert.equal(tracker.markCommandPending("cmd-1"), true);
  assert.equal(tracker.getCommandState("cmd-1"), "pending");

  assert.equal(tracker.markCommandAcked("cmd-1"), true);
  assert.equal(tracker.getCommandState("cmd-1"), "acked");
  assert.equal(tracker.markCommandFailed("cmd-1", "late-fail"), false);

  assert.equal(tracker.markCommandPending("cmd-2"), true);
  assert.equal(tracker.markCommandFailed("cmd-2", "network"), true);
  assert.equal(tracker.getCommandState("cmd-2"), "failed");
  assert.equal(tracker.markCommandAcked("cmd-2"), false);
});

test("command tracker marks events as seen and detects duplicates", () => {
  const tracker = createCommandTracker();

  assert.equal(tracker.markEventSeenAndCheckDuplicate("evt-1"), false);
  assert.equal(tracker.markEventSeenAndCheckDuplicate("evt-1"), true);
  assert.equal(tracker.markEventSeenAndCheckDuplicate(""), false);
});

test("command tracker defers and drains events per command", () => {
  const tracker = createCommandTracker();

  const event = {
    eventId: "evt-10",
    commandId: "cmd-10",
    workspaceSlug: "acme",
    entityId: "123"
  };

  assert.equal(tracker.deferSelfEvent(event), true);
  assert.equal(tracker.deferSelfEvent(event), false);

  const drained = tracker.drainDeferredEventsForCommand("cmd-10", "failed");
  assert.equal(drained.length, 1);
  assert.equal(drained[0].eventId, "evt-10");

  assert.deepEqual(tracker.drainDeferredEventsForCommand("cmd-10", "again"), []);
});

test("command tracker prunes expired entries from all maps", () => {
  const tracker = createCommandTracker();
  const testables = tracker.__testables;

  tracker.markCommandPending("cmd-pending");
  tracker.markCommandPending("cmd-acked");
  tracker.markCommandAcked("cmd-acked");
  tracker.markCommandPending("cmd-failed");
  tracker.markCommandFailed("cmd-failed", "error");
  tracker.markEventSeenAndCheckDuplicate("evt-exp");
  tracker.deferSelfEvent({ eventId: "evt-deferred", commandId: "cmd-deferred" });

  for (const entry of testables.pendingCommandIds.values()) {
    entry.expiresAt = 0;
  }
  for (const entry of testables.ackedCommandIds.values()) {
    entry.expiresAt = 0;
  }
  for (const entry of testables.failedCommandIds.values()) {
    entry.expiresAt = 0;
  }
  for (const eventId of testables.seenEventIds.keys()) {
    testables.seenEventIds.set(eventId, 0);
  }
  for (const entry of testables.deferredSelfEventsByCommandId.values()) {
    entry.expiresAt = 0;
  }

  tracker.pruneExpired(Date.now());

  assert.equal(testables.pendingCommandIds.size, 1);
  assert.equal(testables.ackedCommandIds.size, 0);
  assert.equal(testables.failedCommandIds.size, 0);
  assert.equal(testables.seenEventIds.size, 0);
  assert.equal(testables.deferredSelfEventsByCommandId.size, 0);
});

test("command tracker collects expired pending commands", () => {
  const tracker = createCommandTracker();
  const testables = tracker.__testables;

  tracker.markCommandPending("cmd-a");
  tracker.markCommandPending("cmd-b");

  testables.pendingCommandIds.get("cmd-a").expiresAt = 1;
  testables.pendingCommandIds.get("cmd-b").expiresAt = Date.now() + 99_999;

  const expired = tracker.collectExpiredPendingCommands(Date.now());

  assert.deepEqual(expired, ["cmd-a"]);
  assert.equal(tracker.getCommandState("cmd-a"), "pending");
  assert.equal(tracker.getCommandState("cmd-b"), "pending");
  assert.equal(tracker.markCommandFailed("cmd-a", "expired"), true);
  assert.equal(tracker.getCommandState("cmd-a"), "failed");
});

test("command tracker enforces deferred queue caps", () => {
  const tracker = createCommandTracker();
  const testables = tracker.__testables;

  for (let index = 0; index < 60; index += 1) {
    tracker.deferSelfEvent({
      eventId: `evt-${index}`,
      commandId: "cmd-cap"
    });
  }

  const drained = tracker.drainDeferredEventsForCommand("cmd-cap", "capacity");
  assert.ok(drained.length <= testables.MAX_DEFERRED_EVENTS_PER_COMMAND);
});
