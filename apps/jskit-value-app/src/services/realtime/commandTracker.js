import { createCommandTracker } from "@jskit-ai/realtime-client-runtime";

const COMMAND_TRACKER_OPTIONS = Object.freeze({
  commandTtlMs: 45_000,
  finalizedTtlMs: 120_000,
  deferredEventTtlMs: 75_000,
  maxDeferredEventsPerCommand: 40,
  maxDeferredEventsTotal: 2500
});

const commandTracker = createCommandTracker(COMMAND_TRACKER_OPTIONS);
const __testables = commandTracker.__testables;

export { commandTracker, __testables };
