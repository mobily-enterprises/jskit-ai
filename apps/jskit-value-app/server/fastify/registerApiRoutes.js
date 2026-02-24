import { mergeAuthPolicy } from "@jskit-ai/fastify-auth-policy";

import { safeRequestUrl } from "@jskit-ai/server-runtime-core/requestUrl";
import { registerApiRouteDefinitions } from "@jskit-ai/server-runtime-core/apiRouteRegistration";
import { buildRoutes } from "../modules/api/index.js";
import { toVersionedApiPath } from "../../shared/apiPaths.js";

function registerApiRoutes(fastify, { controllers, routes, routeConfig } = {}) {
  const sourceRouteList = Array.isArray(routes) && routes.length > 0 ? routes : buildRoutes(controllers, routeConfig || {});
  const routeList = sourceRouteList.map((route) => ({
    ...route,
    path: toVersionedApiPath(route.path)
  }));

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
