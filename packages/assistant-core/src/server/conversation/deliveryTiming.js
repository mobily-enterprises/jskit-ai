// Finer marks within each phase locate slow work. Hosts declare any marks of
// their own preparation through hostStages.
const stages = new Set([
  "received", "preparation-started", "authorized", "history-read", "state-read", "request-saved",
  "input-prepared", "provider-started", "duplicate-checked", "native-history-read", "process-ready",
  "prompt-rendered", "metadata-ready", "runtime-ready", "dispatch-started",
  "native-acknowledged", "receipt-written", "state-active", "receipt-persisted", "admission-authorized",
  "turn-located", "accepted", "first-response", "failed"
]);
const hostStagePattern = /^[a-z][a-z-]{0,63}$/u;

export function normalizeConversationDeliveryHostStages(hostStages = []) {
  if (!Array.isArray(hostStages) || hostStages.some(stage => typeof stage !== "string" || !hostStagePattern.test(stage))) {
    throw new TypeError("Host delivery stages must be lowercase hyphenated names.");
  }
  return Object.freeze([...new Set(hostStages)]);
}

// Observer results are never awaited and failures cannot change delivery.
export function createConversationDeliveryTiming({ engine, conversationId, messageId, report, hostStages = [],
  clock = () => performance.now() }) {
  const startedAt = clock();
  let previousAt = startedAt;
  let previousStage = "";
  const timings = {};
  return stage => {
    if (!report || !(stages.has(stage) || hostStages.includes(stage)) || Object.hasOwn(timings, stage)) return;
    const at = clock();
    timings[stage] = Math.max(0, at - startedAt);
    const event = { engine, conversationId, messageId, stage, previousStage,
      durationMs: Math.max(0, at - previousAt), elapsedMs: timings[stage], timings: { ...timings } };
    previousAt = at;
    previousStage = stage;
    try { Promise.resolve(report(event)).catch(() => {}); }
    catch { /* Instrumentation never changes admission or provider work. */ }
  };
}
