import { AppError } from "@jskit-ai/kernel/server/runtime";
import { resolveAssistantSurfaceConfig } from "../../shared/assistantSurfaces.js";

function requireAssistantSurface(appConfig = {}, targetSurfaceId = "") {
  const assistantSurface = resolveAssistantSurfaceConfig(appConfig, targetSurfaceId);
  if (assistantSurface) {
    return assistantSurface;
  }

  throw new AppError(404, "Assistant not found.", { code: "assistant.runtime.route.assistantNotFound" });
}

export { requireAssistantSurface };
