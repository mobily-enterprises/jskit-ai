import { normalizeRouteVisibility } from "../../shared/support/visibility.js";
import { isRecord } from "../../shared/support/normalize.js";

function normalizeRoutePolicyConfig(routeOptions, route) {
  const sourceRouteOptions = isRecord(routeOptions) ? routeOptions : {};
  const sourceConfig = isRecord(sourceRouteOptions.config) ? sourceRouteOptions.config : {};
  const sourceRoute = isRecord(route) ? route : {};

  const nextConfig = {
    ...sourceConfig
  };

  if (Object.prototype.hasOwnProperty.call(sourceRoute, "auth")) {
    nextConfig.authPolicy = sourceRoute.auth;
  }
  if (Object.prototype.hasOwnProperty.call(sourceRoute, "contextPolicy")) {
    nextConfig.contextPolicy = sourceRoute.contextPolicy;
  }
  if (Object.prototype.hasOwnProperty.call(sourceRoute, "surface")) {
    nextConfig.surface = sourceRoute.surface;
  }
  if (Object.prototype.hasOwnProperty.call(sourceRoute, "visibility")) {
    nextConfig.visibility = normalizeRouteVisibility(sourceRoute.visibility);
  }
  if (Object.prototype.hasOwnProperty.call(sourceRoute, "permission")) {
    nextConfig.permission = sourceRoute.permission;
  }
  if (Object.prototype.hasOwnProperty.call(sourceRoute, "ownerParam")) {
    nextConfig.ownerParam = sourceRoute.ownerParam;
  }
  if (Object.prototype.hasOwnProperty.call(sourceRoute, "userField")) {
    nextConfig.userField = sourceRoute.userField;
  }
  if (Object.prototype.hasOwnProperty.call(sourceRoute, "ownerResolver")) {
    nextConfig.ownerResolver = sourceRoute.ownerResolver;
  }
  if (Object.prototype.hasOwnProperty.call(sourceRoute, "csrfProtection")) {
    nextConfig.csrfProtection = sourceRoute.csrfProtection;
  }

  return nextConfig;
}

function defaultApplyRoutePolicy(routeOptions, route) {
  return {
    ...routeOptions,
    config: normalizeRoutePolicyConfig(routeOptions, route)
  };
}

export { normalizeRoutePolicyConfig, defaultApplyRoutePolicy };
