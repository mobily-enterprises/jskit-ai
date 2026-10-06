import { AppError } from "@jskit-ai/kernel/server/runtime";
import { composeSchemaDefinitions } from "@jskit-ai/kernel/shared/validators";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { resolveAssistantSurfaceConfig } from "../../shared/assistantSurfaces.js";
import { assistantSurfaceRouteParamsValidator } from "../inputSchemas.js";

function requireWorkspaceAssistantRouteParams(workspaceScopeSupport = null) {
  if (!workspaceScopeSupport) {
    throw new Error("Assistant workspace routes require workspace server scope support.");
  }

  return composeSchemaDefinitions(
    [workspaceScopeSupport.params, assistantSurfaceRouteParamsValidator],
    {
      mode: "patch",
      context: "assistant-runtime workspace surface route params"
    }
  );
}

function readWorkspaceInput(request, requiresWorkspace, workspaceScopeSupport = null) {
  if (requiresWorkspace !== true) {
    return {};
  }

  if (!workspaceScopeSupport) {
    throw new Error("Assistant workspace routes require workspace server scope support.");
  }

  return workspaceScopeSupport.buildInputFromRouteParams(request?.input?.params);
}

function requireAssistantSurface(appConfig = {}, targetSurfaceId = "") {
  const assistantSurface = resolveAssistantSurfaceConfig(appConfig, targetSurfaceId);
  if (assistantSurface) {
    return assistantSurface;
  }

  throw new AppError(404, "Assistant not found.");
}

function requireHostSurfaceId(request) {
  const headerValue = Array.isArray(request?.headers?.["x-jskit-surface"])
    ? request.headers["x-jskit-surface"][0]
    : request?.headers?.["x-jskit-surface"];
  const hostSurfaceId = normalizeSurfaceId(headerValue);
  if (hostSurfaceId) {
    return hostSurfaceId;
  }

  throw new AppError(400, "Assistant surface header x-jskit-surface is required.");
}

function resolveRouteRequestState(
  request,
  {
    resolveCurrentAppConfig = () => ({}),
    kind = "runtime",
    requiresWorkspace = false,
    workspaceScopeSupport = null
  } = {}
) {
  const appConfig = resolveCurrentAppConfig();
  const targetSurfaceId = normalizeSurfaceId(request?.input?.params?.surfaceId);
  const assistantSurface = requireAssistantSurface(appConfig, targetSurfaceId);
  const hostSurfaceId = requireHostSurfaceId(request);
  const expectsWorkspace = kind === "settings"
    ? assistantSurface.settingsSurfaceRequiresWorkspace
    : assistantSurface.runtimeSurfaceRequiresWorkspace;
  const expectedHostSurfaceId = kind === "settings"
    ? assistantSurface.settingsSurfaceId
    : assistantSurface.targetSurfaceId;

  if (expectsWorkspace !== (requiresWorkspace === true)) {
    throw new AppError(404, "Assistant route not found.");
  }
  if (hostSurfaceId !== expectedHostSurfaceId) {
    throw new AppError(403, "Assistant route is not available on this surface.");
  }

  return Object.freeze({
    assistantSurface,
    hostSurfaceId,
    actionInput: Object.freeze({
      targetSurfaceId: assistantSurface.targetSurfaceId,
      ...readWorkspaceInput(request, requiresWorkspace, workspaceScopeSupport)
    })
  });
}

export { requireWorkspaceAssistantRouteParams, resolveRouteRequestState };
