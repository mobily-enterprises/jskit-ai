import { normalizeRouteVisibility, normalizeVisibilityContext } from "../../../shared/support/visibility.js";
import { normalizeText } from "../../../shared/support/normalize.js";
import { RouteRegistrationError } from "./errors.js";

const ROUTE_VISIBILITY_RESOLVER_TAG = Symbol.for("jskit.runtime.http.visibilityResolvers");

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

function normalizeResolverList(value) {
  const queue = Array.isArray(value) ? [...value] : [value];
  const resolved = [];

  while (queue.length > 0) {
    const entry = queue.shift();

    if (Array.isArray(entry)) {
      queue.push(...entry);
      continue;
    }

    const resolver = normalizeRouteVisibilityResolver(entry);
    if (resolver) {
      resolved.push(resolver);
    }
  }

  return resolved;
}

function resolveRouteVisibilityResolvers(scope) {
  if (!scope || typeof scope.resolveTag !== "function") {
    return [];
  }

  return normalizeResolverList(scope.resolveTag(ROUTE_VISIBILITY_RESOLVER_TAG));
}

function registerRouteVisibilityResolver(app, token, factory) {
  if (!app || typeof app.singleton !== "function" || typeof app.tag !== "function") {
    throw new RouteRegistrationError("registerRouteVisibilityResolver requires application singleton()/tag().");
  }

  app.singleton(token, factory);
  app.tag(token, ROUTE_VISIBILITY_RESOLVER_TAG);
}

async function resolveRouteVisibilityContext({
  resolutionScope = null,
  request = null,
  routeVisibility = "public",
  context = {},
  input = {},
  deps = {},
  actionId = "",
  version = null,
  channel = "api"
} = {}) {
  const normalizedRouteVisibility = normalizeRouteVisibility(routeVisibility);
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
    visibility: normalizedRouteVisibility
  });
}

export {
  ROUTE_VISIBILITY_RESOLVER_TAG,
  resolveRouteVisibilityResolvers,
  registerRouteVisibilityResolver,
  resolveRouteVisibilityContext
};
