import { createController as createWorkspaceAdapterController } from "@jskit-ai/workspace-fastify-adapter";
import { REALTIME_EVENT_TYPES, REALTIME_TOPICS } from "../../../shared/eventTypes.js";
import { resolveSurfaceFromPathname } from "../../../shared/surfacePaths.js";

function createController(options = {}) {
  return createWorkspaceAdapterController({
    ...(options && typeof options === "object" ? options : {}),
    resolveSurfaceFromPathname,
    realtimeTopics: REALTIME_TOPICS,
    realtimeEventTypes: REALTIME_EVENT_TYPES
  });
}

export { createController };
