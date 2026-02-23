import { mergeAuthPolicy } from "@jskit-ai/fastify-auth-policy";

import { safeRequestUrl } from "../lib/primitives/requestUrl.js";
import { buildDefaultRoutes } from "../modules/api/routes.js";

function registerApiRoutes(fastify, { controllers, routes, routeConfig } = {}) {
  const routeList =
    Array.isArray(routes) && routes.length > 0 ? routes : buildDefaultRoutes(controllers, routeConfig || {});

  for (const route of routeList) {
    const routeOptions = mergeAuthPolicy(
      {
        method: route.method,
        url: route.path,
        ...(route.schema ? { schema: route.schema } : {}),
        ...(route.bodyLimit ? { bodyLimit: route.bodyLimit } : {}),
        config: {
          ...(route.rateLimit ? { rateLimit: route.rateLimit } : {})
        }
      },
      {
        authPolicy: route.auth,
        workspacePolicy: route.workspacePolicy,
        workspaceSurface: route.workspaceSurface,
        permission: route.permission,
        ownerParam: route.ownerParam,
        userField: route.userField,
        ownerResolver: route.ownerResolver,
        csrfProtection: route.csrfProtection
      }
    );

    fastify.route({
      ...routeOptions,
      handler: async (request, reply) => {
        await route.handler(request, reply, safeRequestUrl(request));
      }
    });
  }
}

export { registerApiRoutes };
