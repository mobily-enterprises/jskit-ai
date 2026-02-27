const DEFAULT_REPLAY_POLICY = Object.freeze({
  maxEventsPerCommand: 25,
  maxEventsPerTick: 75
});

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) {
    return fallback;
  }

  return Math.floor(numeric);
}

function createReplayPolicy(options = {}) {
  return Object.freeze({
    maxEventsPerCommand: normalizePositiveInteger(
      options.maxEventsPerCommand,
      DEFAULT_REPLAY_POLICY.maxEventsPerCommand
    ),
    maxEventsPerTick: normalizePositiveInteger(options.maxEventsPerTick, DEFAULT_REPLAY_POLICY.maxEventsPerTick)
  });
}

export { createReplayPolicy, DEFAULT_REPLAY_POLICY };
