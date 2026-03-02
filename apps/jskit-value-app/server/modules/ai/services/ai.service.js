import {
  createAssistantService as createAssistantCoreService,
  assistantServiceTestables as assistantCoreTestables
} from "@jskit-ai/assistant-core/server";
import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { hasPermission } from "@jskit-ai/rbac-core/server";
import { safePathnameFromRequest } from "@jskit-ai/server-runtime-core/requestUrl";
import {
  publishWorkspaceEventSafely,
  resolvePublishWorkspaceEvent
} from "../../../realtime/publishers/workspacePublisher.js";
import { buildAuditEventBase } from "@jskit-ai/server-runtime-core/securityAudit";
import { REALTIME_EVENT_TYPES, REALTIME_TOPICS } from "../../../../shared/eventTypes.js";
import { resolveSurfaceFromPathname } from "../../../../shared/surfacePaths.js";
import { normalizeSurfaceId } from "../../../../shared/surfaceRegistry.js";
import {
  resolveAssistantSystemPromptAppFromWorkspaceSettings,
  resolveAssistantSystemPromptWorkspaceFromConsoleSettings
} from "@jskit-ai/assistant-core/systemPrompt";
import { createAssistantActionToolsResolver } from "../lib/tools/actionTools.js";

function createService(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const resolveActionExecutor = typeof source.resolveActionExecutor === "function" ? source.resolveActionExecutor : () => null;
  const resolveToolsForSurface = createAssistantActionToolsResolver({
    resolveActionExecutor,
    actionsConfig: source.actionsConfig
  });
  const buildAuditEventBaseWithSurface = (request) =>
    buildAuditEventBase(request, {
      resolveSurfaceFromPathname
    });

  return createAssistantCoreService({
    ...source,
    resolveToolsForSurfaceFn: resolveToolsForSurface,
    tools: [],
    appErrorClass: AppError,
    hasPermissionFn: hasPermission,
    safePathnameFromRequestFn: safePathnameFromRequest,
    publishWorkspaceEventSafelyFn: publishWorkspaceEventSafely,
    resolvePublishWorkspaceEventFn: resolvePublishWorkspaceEvent,
    buildAuditEventBaseFn: buildAuditEventBaseWithSurface,
    realtimeEventTypes: REALTIME_EVENT_TYPES,
    realtimeTopics: REALTIME_TOPICS,
    resolveSurfaceFromPathnameFn: resolveSurfaceFromPathname,
    normalizeSurfaceIdFn: normalizeSurfaceId,
    resolveAssistantSystemPromptAppFromWorkspaceSettingsFn: resolveAssistantSystemPromptAppFromWorkspaceSettings,
    resolveAssistantSystemPromptWorkspaceFromConsoleSettingsFn:
      resolveAssistantSystemPromptWorkspaceFromConsoleSettings
  });
}

const __testables = assistantCoreTestables;

export { createService, __testables };
