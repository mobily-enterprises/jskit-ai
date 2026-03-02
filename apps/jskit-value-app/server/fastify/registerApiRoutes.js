import { mergeAuthPolicy } from "@jskit-ai/fastify-auth-policy/server";

import { safeRequestUrl } from "@jskit-ai/server-runtime-core/requestUrl";
import { registerApiRouteDefinitions } from "@jskit-ai/server-runtime-core/apiRouteRegistration";
import { buildRoutes } from "../modules/api/index.js";
import { API_PREFIX, toVersionedApiPath } from "../../shared/apiPaths.js";

const CONSOLE_API_PREFIX = `${API_PREFIX}/console`;

function isConsoleApiPath(pathValue) {
  const normalized = toVersionedApiPath(pathValue);
  return normalized === CONSOLE_API_PREFIX || normalized.startsWith(`${CONSOLE_API_PREFIX}/`);
}

function assertConsoleRoutePolicy(route) {
  if (!isConsoleApiPath(route?.path)) {
    return;
  }

  const workspacePolicy = String(route.workspacePolicy || "").trim();
  const workspaceSurface = String(route.workspaceSurface || "").trim();
  if (workspacePolicy && workspaceSurface) {
    return;
  }

  throw new Error(
    `Console route "${route.method || "GET"} ${route.path}" must declare workspacePolicy and workspaceSurface.`
  );
}

function registerApiRoutes(fastify, { controllers, routes, routeConfig } = {}) {
  const sourceRouteList = Array.isArray(routes) && routes.length > 0 ? routes : buildRoutes(controllers, routeConfig || {});
  const routeList = sourceRouteList.map((route) => ({
    ...route,
    path: toVersionedApiPath(route.path)
  }));
  for (const route of routeList) {
    assertConsoleRoutePolicy(route);
  }

  registerApiRouteDefinitions(fastify, {
    routes: routeList,
    resolveRequestUrl: safeRequestUrl,
    applyRoutePolicy(routeOptions, route) {
      return mergeAuthPolicy(routeOptions, {
        authPolicy: route.auth,
        workspacePolicy: route.workspacePolicy,
        workspaceSurface: route.workspaceSurface,
        permission: route.permission,
        ownerParam: route.ownerParam,
        userField: route.userField,
        ownerResolver: route.ownerResolver,
        csrfProtection: route.csrfProtection
      });
    }
  });
}

export { registerApiRoutes };
