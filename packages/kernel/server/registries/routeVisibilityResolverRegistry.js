import { normalizeRouteVisibility, normalizeRouteVisibilityToken, normalizeVisibilityContext } from "../../shared/support/visibility.js";
import { normalizeText } from "../../shared/support/normalize.js";
import { ROUTE_VISIBILITY_PUBLIC } from "../../shared/support/policies.js";
import { RouteRegistrationError } from "../http/lib/errors.js";
import { registerTaggedSingleton, resolveTaggedEntries } from "./primitives.js";

function normalizeRouteVisibilityResolver(entry) {
  if (typeof entry === "function") {
    return {
      resolverId: normalizeText(entry.name) || "anonymous",
      resolve: entry
    };
  }

  if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.resolve !== "function") {
    return null;
  }

  return {
    resolverId: normalizeText(entry.resolverId) || "anonymous",
    resolve: entry.resolve
  };
}

function resolveRouteVisibilityResolvers(scope) {
  return resolveTaggedEntries(scope, "jskit.runtime.http.visibilityResolvers")
    .map((entry) => normalizeRouteVisibilityResolver(entry))
    .filter(Boolean);
}

function registerRouteVisibilityResolver(app, token, factory) {
  registerTaggedSingleton(app, token, factory, "jskit.runtime.http.visibilityResolvers", {
    context: "registerRouteVisibilityResolver",
    ErrorType: RouteRegistrationError
  });
}

async function resolveRouteVisibilityContext({
  resolutionScope = null,
  request = null,
  routeVisibility = ROUTE_VISIBILITY_PUBLIC,
  context = {},
  input = {},
  deps = {},
  actionId = "",
  version = null,
  channel = "api"
} = {}) {
  const normalizedRouteVisibility = normalizeRouteVisibilityToken(routeVisibility);
  const normalizedCoreVisibility = normalizeRouteVisibility(normalizedRouteVisibility);
  const resolvers = resolveRouteVisibilityResolvers(resolutionScope);
  const patch = {};

  for (const resolver of resolvers) {
    const contribution = await resolver.resolve({
      request,
      visibility: normalizedRouteVisibility,
      context,
      input,
      deps,
      actionId: normalizeText(actionId),
      version: version == null ? null : version,
      channel: normalizeText(channel).toLowerCase() || "api"
    });

    if (!contribution || typeof contribution !== "object" || Array.isArray(contribution)) {
      continue;
    }

    Object.assign(patch, contribution);
  }

  return normalizeVisibilityContext({
    ...patch,
    visibility: normalizedRouteVisibility,
    requiresActorScope: patch.requiresActorScope === true || normalizedCoreVisibility === "user"
  });
}

export {
  resolveRouteVisibilityResolvers,
  registerRouteVisibilityResolver,
  resolveRouteVisibilityContext
};
