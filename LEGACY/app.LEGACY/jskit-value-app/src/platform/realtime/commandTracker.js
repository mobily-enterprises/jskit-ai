import { createCommandTracker } from "@jskit-ai/realtime-client-runtime/client";

const COMMAND_TRACKER_OPTIONS = Object.freeze({
  commandTtlMs: 60_000,
  finalizedTtlMs: 180_000,
  seenEventTtlMs: 180_000,
  deferredEventTtlMs: 120_000,
  maxCommandEntries: 2000,
  maxSeenEvents: 8000,
  maxDeferredCommands: 1200,
  maxDeferredEventsPerCommand: 60,
  maxDeferredEventsTotal: 6000
});

const commandTracker = createCommandTracker(COMMAND_TRACKER_OPTIONS);
const __testables = commandTracker.__testables;

export { commandTracker, __testables };
