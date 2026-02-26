import { REALTIME_EVENT_TYPES, REALTIME_TOPICS } from "../../shared/eventTypes.js";
import { getTopicRule, listRealtimeTopics, listRealtimeTopicsForSurface } from "../../shared/topicRegistry.js";

function composeRealtimePolicy({ surface } = {}) {
  const topics =
    surface == null || String(surface || "").trim() === ""
      ? listRealtimeTopics()
      : listRealtimeTopicsForSurface(surface);

  return {
    topics,
    rules: Object.freeze(
      Object.fromEntries(
        topics.map((topic) => {
          const rule = getTopicRule(topic);
          return [topic, rule];
        })
      )
    ),
    topicConstants: REALTIME_TOPICS,
    eventTypeConstants: REALTIME_EVENT_TYPES
  };
}

export { composeRealtimePolicy };
