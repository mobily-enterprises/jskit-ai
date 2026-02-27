import { createController as createWorkspaceAdapterController } from "@jskit-ai/workspace-service-core";
import { REALTIME_EVENT_TYPES, REALTIME_TOPICS } from "../../../shared/eventTypes.js";

function createController(options = {}) {
  return createWorkspaceAdapterController({
    ...(options && typeof options === "object" ? options : {}),
    realtimeTopics: REALTIME_TOPICS,
    realtimeEventTypes: REALTIME_EVENT_TYPES
  });
}

export { createController };
