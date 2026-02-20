import { safeRequestUrl } from "../lib/primitives/requestUrl.js";
import { buildDefaultRoutes } from "../modules/api/routes.js";

function registerApiRoutes(fastify, { controllers, routes, routeConfig } = {}) {
  const routeList =
    Array.isArray(routes) && routes.length > 0 ? routes : buildDefaultRoutes(controllers, routeConfig || {});

  for (const route of routeList) {
    fastify.route({
      method: route.method,
      url: route.path,
      ...(route.schema ? { schema: route.schema } : {}),
      config: {
        authPolicy: route.auth || "public",
        workspacePolicy: route.workspacePolicy || "none",
        workspaceSurface: route.workspaceSurface || "",
        permission: route.permission || "",
        ownerParam: route.ownerParam || null,
        userField: route.userField || "id",
        ownerResolver: typeof route.ownerResolver === "function" ? route.ownerResolver : null,
        csrfProtection: route.csrfProtection !== false,
        ...(route.rateLimit ? { rateLimit: route.rateLimit } : {})
      },
      handler: async (request, reply) => {
        await route.handler(request, reply, safeRequestUrl(request));
      }
    });
  }
}

export { registerApiRoutes };
