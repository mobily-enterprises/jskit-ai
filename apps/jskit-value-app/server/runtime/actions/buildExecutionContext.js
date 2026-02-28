import { normalizeExecutionContext, normalizeText } from "@jskit-ai/action-runtime-core";
import { resolveClientIpAddress } from "@jskit-ai/server-runtime-core/requestUrl";
import { resolveRequestSurface } from "../../shared/resolveRequestSurface.js";

function resolveActor({ request, actor }) {
  if (actor && typeof actor === "object") {
    return actor;
  }

  const requestActor = request?.user;
  if (requestActor && typeof requestActor === "object") {
    return requestActor;
  }

  return null;
}

function resolveRequestMeta({ request, requestMeta = {} }) {
  const source = requestMeta && typeof requestMeta === "object" ? requestMeta : {};

  return {
    requestId: normalizeText(source.requestId || request?.id),
    commandId: normalizeText(source.commandId || request?.headers?.["x-command-id"]),
    idempotencyKey: normalizeText(source.idempotencyKey || request?.headers?.["idempotency-key"]),
    ip: normalizeText(source.ip || resolveClientIpAddress(request)),
    userAgent: normalizeText(source.userAgent || request?.headers?.["user-agent"]),
    request
  };
}

function buildExecutionContext({
  request = null,
  actor = null,
  workspace = null,
  membership = null,
  permissions = null,
  surface = "",
  channel = "internal",
  requestMeta = {},
  assistantMeta = {},
  timeMeta = {}
} = {}) {
  const requestPermissions = Array.isArray(request?.permissions) ? request.permissions : [];
  const normalizedPermissions = Array.isArray(permissions) ? permissions : requestPermissions;

  return normalizeExecutionContext({
    actor: resolveActor({
      request,
      actor
    }),
    workspace: workspace || request?.workspace || null,
    membership: membership || request?.membership || null,
    permissions: normalizedPermissions,
    surface: resolveRequestSurface({
      request,
      explicitSurface: surface
    }),
    channel,
    requestMeta: resolveRequestMeta({
      request,
      requestMeta
    }),
    assistantMeta,
    timeMeta
  });
}

export { buildExecutionContext };
