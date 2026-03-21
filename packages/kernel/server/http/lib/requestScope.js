import { KERNEL_TOKENS } from "../../../shared/support/tokens.js";

function resolveRequestRuntimeId({ request = null, requestIdResolver = null } = {}) {
  if (typeof requestIdResolver === "function") {
    const resolvedByResolver = String(requestIdResolver(request) || "").trim();
    if (resolvedByResolver) {
      return resolvedByResolver;
    }
  }

  const resolvedFromRequest = String(request?.id || "").trim();
  if (resolvedFromRequest) {
    return resolvedFromRequest;
  }

  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeRequestScopeProperty(value) {
  const normalized = String(value || "").trim();
  return normalized || "scope";
}

function attachRequestScope({
  app = null,
  request = null,
  reply = null,
  requestScopeProperty = "scope",
  requestScopeIdPrefix = "http",
  requestIdResolver = null
} = {}) {
  if (!app || typeof app.createScope !== "function") {
    return null;
  }

  const runtimeRequestId = resolveRequestRuntimeId({
    request,
    requestIdResolver
  });

  const scopePrefix = String(requestScopeIdPrefix || "").trim() || "http";
  const scope = app.createScope(`${scopePrefix}:${runtimeRequestId}`);
  if (!scope || typeof scope.instance !== "function") {
    return null;
  }

  scope.instance(KERNEL_TOKENS.Request, request);
  scope.instance(KERNEL_TOKENS.Reply, reply);
  scope.instance(KERNEL_TOKENS.RequestId, runtimeRequestId);
  scope.instance(KERNEL_TOKENS.RequestScope, scope);

  if (request && typeof request === "object") {
    request[normalizeRequestScopeProperty(requestScopeProperty)] = scope;
  }

  return scope;
}

export { normalizeRequestScopeProperty, attachRequestScope };
