import { safeRequestUrl } from "../../lib/requestUrl.js";
import { buildAuthRoutes } from "../../server/modules/auth/routes.js";
import { buildWorkspaceRoutes } from "../../server/modules/workspace/routes.js";
import { buildProjectsRoutes } from "../../server/modules/projects/routes.js";
import { buildSettingsRoutes } from "../../server/modules/settings/routes.js";
import { buildHistoryRoutes } from "../../server/modules/history/routes.js";
import { buildAnnuityRoutes } from "../../server/modules/annuity/routes.js";

function createMissingHandler() {
  return async (_request, reply) => {
    reply.code(501).send({
      error: "Endpoint is not available in this server wiring."
    });
  };
}

function buildDefaultRoutes(controllers) {
  const missingHandler = createMissingHandler();

  return [
    ...buildAuthRoutes(controllers),
    ...buildWorkspaceRoutes(controllers, { missingHandler }),
    ...buildProjectsRoutes(controllers, { missingHandler }),
    ...buildSettingsRoutes(controllers),
    ...buildHistoryRoutes(controllers),
    ...buildAnnuityRoutes(controllers)
  ];
}

function registerApiRoutes(fastify, { controllers, routes }) {
  const routeList = Array.isArray(routes) && routes.length > 0 ? routes : buildDefaultRoutes(controllers);

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

export { buildDefaultRoutes, registerApiRoutes };
