import { buildRoutes as buildAuthRoutes } from "../auth/routes.js";
import { buildRoutes as buildWorkspaceRoutes } from "../workspace/routes.js";
import { buildRoutes as buildProjectsRoutes } from "../projects/routes.js";
import { buildRoutes as buildSettingsRoutes } from "../settings/routes.js";
import { buildRoutes as buildHistoryRoutes } from "../history/routes.js";
import { buildRoutes as buildAnnuityRoutes } from "../annuity/routes.js";

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

export { buildDefaultRoutes };
