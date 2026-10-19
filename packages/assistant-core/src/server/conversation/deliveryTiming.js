// Finer marks within each phase locate slow work. Hosts may mark git-actor
// and genesis-rendered while preparing a native prompt.
const stages = new Set([
  "received", "preparation-started", "authorized", "history-read", "state-read", "request-saved",
  "input-prepared", "provider-started", "duplicate-checked", "native-history-read", "process-ready",
  "git-actor", "genesis-rendered", "prompt-rendered", "metadata-ready", "runtime-ready", "dispatch-started",
  "native-acknowledged", "receipt-written", "state-active", "receipt-persisted", "admission-authorized",
  "turn-located", "accepted", "first-response", "failed"
]);

// Observer results are never awaited and failures cannot change delivery.
export function createConversationDeliveryTiming({ engine, conversationId, messageId, report, clock = () => performance.now() }) {
  const startedAt = clock();
  let previousAt = startedAt;
  let previousStage = "";
  const timings = {};
  return stage => {
    if (!report || !stages.has(stage) || Object.hasOwn(timings, stage)) return;
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
