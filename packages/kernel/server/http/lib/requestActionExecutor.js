import { normalizeObject, normalizeText } from "../../../shared/support/normalize.js";
import { normalizeRouteVisibilityToken } from "../../../shared/support/visibility.js";
import { resolveActionContextContributors } from "../../actions/ActionRuntimeServiceProvider.js";
import { resolveRouteVisibilityContext } from "../../registries/routeVisibilityResolverRegistry.js";
import { resolveDefaultSurfaceId } from "../../support/appConfig.js";
import { RouteRegistrationError } from "./errors.js";
import { normalizeRequestScopeProperty } from "./requestScope.js";

function normalizeRequestActionExecutorProperty(value) {
  const normalized = String(value || "").trim();
  return normalized || "executeAction";
}

function resolveSurfaceFromRequest(request, explicitSurface = "", defaultSurfaceId = "") {
  const normalizedExplicitSurface = normalizeText(explicitSurface).toLowerCase();
  if (normalizedExplicitSurface) {
    return normalizedExplicitSurface;
  }

  const normalizedRouteSurface = normalizeText(request?.routeOptions?.config?.surface).toLowerCase();
  if (normalizedRouteSurface) {
    return normalizedRouteSurface;
  }

  const normalizedRequestSurface = normalizeText(request?.surface).toLowerCase();
  if (normalizedRequestSurface) {
    return normalizedRequestSurface;
  }

  return resolveDefaultSurfaceId(null, {
    defaultSurfaceId
  });
}

function buildActionExecutionContext({ request = null, context = {}, channel = "api", defaultSurfaceId = "" } = {}) {
  const source = normalizeObject(context);
  const sourceRequestMeta = normalizeObject(source.requestMeta);

  return {
    ...source,
    channel: normalizeText(source.channel || channel).toLowerCase() || "api",
    surface: resolveSurfaceFromRequest(request, source.surface, defaultSurfaceId),
    requestMeta: {
      ...sourceRequestMeta,
      request
    }
  };
}

function applyActionContextContributionDefaults(targetContext, contribution) {
  const patch = normalizeObject(contribution);
  if (Object.keys(patch).length < 1) {
    return targetContext;
  }

  for (const [key, value] of Object.entries(patch)) {
    if (key === "requestMeta") {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(targetContext, key)) {
      continue;
    }
    targetContext[key] = value;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "requestMeta")) {
    const targetRequestMeta = normalizeObject(targetContext.requestMeta);
    const patchRequestMeta = normalizeObject(patch.requestMeta);
    for (const [key, value] of Object.entries(patchRequestMeta)) {
      if (Object.prototype.hasOwnProperty.call(targetRequestMeta, key)) {
        continue;
      }
      targetRequestMeta[key] = value;
    }
    targetContext.requestMeta = targetRequestMeta;
  }

  return targetContext;
}

async function enrichActionExecutionContext({
  resolutionScope = null,
  request = null,
  actionId = "",
  version = null,
  input = {},
  deps = {},
  channel = "api",
  baseContext = {}
} = {}) {
  const contributors = resolveActionContextContributors(resolutionScope);
  if (contributors.length < 1) {
    return baseContext;
  }

  const normalizedActionId = normalizeText(actionId);
  const normalizedChannel = normalizeText(channel).toLowerCase() || "api";
  const normalizedInput = normalizeObject(input);
  const normalizedDeps = normalizeObject(deps);
  const mutableContext = normalizeObject(baseContext);

  for (const contributor of contributors) {
    if (!contributor || typeof contributor.contribute !== "function") {
      continue;
    }

    const contribution = await contributor.contribute({
      request,
      actionId: normalizedActionId,
      version: version == null ? null : version,
      input: normalizedInput,
      deps: normalizedDeps,
      channel: normalizedChannel,
      surface: mutableContext.surface,
      context: { ...mutableContext }
    });

    applyActionContextContributionDefaults(mutableContext, contribution);
  }

  return mutableContext;
}

function resolveActionExecutorScope({ app = null, request = null, requestScopeProperty = "scope" } = {}) {
  const normalizedScopeProperty = normalizeRequestScopeProperty(requestScopeProperty);
  const requestScope =
    request && typeof request === "object" && request[normalizedScopeProperty] && typeof request[normalizedScopeProperty] === "object"
      ? request[normalizedScopeProperty]
      : null;

  if (requestScope && typeof requestScope.make === "function") {
    return requestScope;
  }

  if (app && typeof app.make === "function") {
    return app;
  }

  return null;
}

function resolveRouteVisibilityFromRequestAndPayload(request, payload = {}) {
  const routeConfig =
    request?.routeOptions?.config && typeof request.routeOptions.config === "object" ? request.routeOptions.config : null;
  if (routeConfig && Object.prototype.hasOwnProperty.call(routeConfig, "visibility")) {
    return normalizeRouteVisibilityToken(routeConfig.visibility);
  }

  return normalizeRouteVisibilityToken(payload.visibility);
}

function attachRequestActionExecutor({
  app = null,
  request = null,
  requestScopeProperty = "scope",
  requestActionExecutorProperty = "executeAction",
  actionExecutorToken = "actionExecutor",
  defaultChannel = "api",
  defaultSurfaceId = ""
} = {}) {
  if (!request || typeof request !== "object") {
    return null;
  }

  const normalizedProperty = normalizeRequestActionExecutorProperty(requestActionExecutorProperty);
  if (typeof request[normalizedProperty] === "function") {
    return request[normalizedProperty];
  }

  const normalizedActionExecutorToken = normalizeText(actionExecutorToken) || "actionExecutor";
  const normalizedDefaultChannel = normalizeText(defaultChannel).toLowerCase() || "api";
  const initialResolutionScope = resolveActionExecutorScope({
    app,
    request,
    requestScopeProperty
  });

  if (!initialResolutionScope || typeof initialResolutionScope.has !== "function" || typeof initialResolutionScope.make !== "function") {
    return null;
  }

  const executeAction = async (payload = {}) => {
    const source = normalizeObject(payload);
    const normalizedInput = normalizeObject(source.input);
    const normalizedDeps = normalizeObject(source.deps);
    const normalizedChannel = normalizeText(source.channel || normalizedDefaultChannel).toLowerCase() || normalizedDefaultChannel;
    const resolutionScope = resolveActionExecutorScope({
      app,
      request,
      requestScopeProperty
    });

    if (!resolutionScope || typeof resolutionScope.has !== "function" || typeof resolutionScope.make !== "function") {
      throw new RouteRegistrationError("request.executeAction requires a container scope with has()/make().");
    }
    if (!resolutionScope.has(normalizedActionExecutorToken)) {
      throw new RouteRegistrationError(`request.executeAction requires "${normalizedActionExecutorToken}" binding.`);
    }

    const actionExecutor = resolutionScope.make(normalizedActionExecutorToken);
    if (!actionExecutor || typeof actionExecutor.execute !== "function") {
      throw new RouteRegistrationError(`"${normalizedActionExecutorToken}" must provide execute().`);
    }

    const baseContext = buildActionExecutionContext({
      request,
      context: normalizeObject(source.context),
      channel: normalizedChannel,
      defaultSurfaceId
    });
    const executionContext = await enrichActionExecutionContext({
      resolutionScope,
      request,
      actionId: source.actionId,
      version: source.version == null ? null : source.version,
      input: normalizedInput,
      deps: normalizedDeps,
      channel: normalizedChannel,
      baseContext
    });
    const visibilityContext = await resolveRouteVisibilityContext({
      resolutionScope,
      request,
      routeVisibility: resolveRouteVisibilityFromRequestAndPayload(request, source),
      context: executionContext,
      input: normalizedInput,
      deps: normalizedDeps,
      actionId: source.actionId,
      version: source.version == null ? null : source.version,
      channel: normalizedChannel
    });
    executionContext.visibilityContext = visibilityContext;
    executionContext.requestMeta = {
      ...normalizeObject(executionContext.requestMeta),
      visibilityContext,
      routeVisibility: visibilityContext.visibility
    };

    return actionExecutor.execute({
      actionId: source.actionId,
      version: source.version == null ? null : source.version,
      input: normalizedInput,
      context: executionContext,
      deps: normalizedDeps
    });
  };

  Object.defineProperty(request, normalizedProperty, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: executeAction
  });

  return request[normalizedProperty];
}

export { buildActionExecutionContext, attachRequestActionExecutor };
