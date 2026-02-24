import {
  createAssistantService as createAssistantCoreService,
  assistantServiceTestables as assistantCoreTestables
} from "@jskit-ai/assistant-core";
import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { hasPermission } from "@jskit-ai/rbac-core";
import { safePathnameFromRequest } from "@jskit-ai/server-runtime-core/requestUrl";
import {
  publishWorkspaceEventSafely,
  resolvePublishWorkspaceEvent
} from "../../realtime/publishers/workspacePublisher.js";
import { buildAuditEventBase } from "@jskit-ai/server-runtime-core/securityAudit";
import { REALTIME_EVENT_TYPES, REALTIME_TOPICS } from "../../../shared/realtime/eventTypes.js";
import { resolveSurfaceFromPathname } from "../../../shared/routing/surfacePaths.js";
import { normalizeSurfaceId } from "../../../shared/routing/surfaceRegistry.js";
import {
  resolveAssistantSystemPromptAppFromWorkspaceSettings,
  resolveAssistantSystemPromptWorkspaceFromConsoleSettings
} from "@jskit-ai/assistant-core/systemPrompt";
import { createWorkspaceRenameTool } from "./tools/workspaceRename.tool.js";

const DEFAULT_ASSISTANT_TOOL_SURFACE_ALLOWLIST = Object.freeze({
  app: Object.freeze([]),
  admin: Object.freeze(["workspace_rename"])
});

function createService(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const configuredTools = Array.isArray(source.tools) ? source.tools : [];
  const workspaceRenameTool = createWorkspaceRenameTool(source);
  const assistantToolSurfaceAllowlist =
    source.assistantToolSurfaceAllowlist && typeof source.assistantToolSurfaceAllowlist === "object"
      ? source.assistantToolSurfaceAllowlist
      : DEFAULT_ASSISTANT_TOOL_SURFACE_ALLOWLIST;
  const buildAuditEventBaseWithSurface = (request) =>
    buildAuditEventBase(request, {
      resolveSurfaceFromPathname
    });

  return createAssistantCoreService({
    ...source,
    tools: [workspaceRenameTool, ...configuredTools],
    assistantToolSurfaceAllowlist,
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
