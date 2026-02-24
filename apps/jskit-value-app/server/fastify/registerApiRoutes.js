import { mergeAuthPolicy } from "@jskit-ai/fastify-auth-policy";

import { safeRequestUrl } from "@jskit-ai/server-runtime-core/requestUrl";
import { registerApiRouteDefinitions } from "@jskit-ai/server-runtime-core/apiRouteRegistration";
import { buildDefaultRoutes } from "../modules/api/index.js";

function registerApiRoutes(fastify, { controllers, routes, routeConfig } = {}) {
  const routeList =
    Array.isArray(routes) && routes.length > 0 ? routes : buildDefaultRoutes(controllers, routeConfig || {});

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
