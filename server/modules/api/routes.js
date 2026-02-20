import { buildRoutes as buildAuthRoutes } from "../auth/routes.js";
import { buildRoutes as buildWorkspaceRoutes } from "../workspace/routes.js";
import { buildRoutes as buildConsoleRoutes } from "../console/routes.js";
import { buildRoutes as buildConsoleErrorsRoutes } from "../consoleErrors/routes.js";
import { buildRoutes as buildCommunicationsRoutes } from "../communications/routes.js";
import { buildRoutes as buildProjectsRoutes } from "../projects/routes.js";
import { buildRoutes as buildSettingsRoutes } from "../settings/routes.js";
import { buildRoutes as buildHistoryRoutes } from "../history/routes.js";
import { buildRoutes as buildAnnuityRoutes } from "../annuity/routes.js";
import { buildRoutes as buildHealthRoutes } from "../health/routes.js";
import { buildRoutes as buildObservabilityRoutes } from "../observability/routes.js";
import { buildRoutes as buildAiRoutes } from "../ai/routes.js";

function createMissingHandler() {
  return async (_request, reply) => {
    reply.code(501).send({
      error: "Endpoint is not available in this server wiring."
    });
  };
}

function buildDefaultRoutes(controllers, routeConfig = {}) {
  const missingHandler = createMissingHandler();

  return [
    ...buildHealthRoutes(controllers, { missingHandler }),
    ...buildObservabilityRoutes(controllers, { missingHandler }),
    ...buildAuthRoutes(controllers),
    ...buildWorkspaceRoutes(controllers, { missingHandler }),
    ...buildConsoleRoutes(controllers, { missingHandler }),
    ...buildConsoleErrorsRoutes(controllers, { missingHandler }),
    ...buildCommunicationsRoutes(controllers, { missingHandler }),
    ...buildProjectsRoutes(controllers, { missingHandler }),
    ...buildAiRoutes(controllers, {
      missingHandler,
      aiEnabled: routeConfig.aiEnabled,
      aiRequiredPermission: routeConfig.aiRequiredPermission,
      aiMaxInputChars: routeConfig.aiMaxInputChars,
      aiMaxHistoryMessages: routeConfig.aiMaxHistoryMessages
    }),
    ...buildSettingsRoutes(controllers),
    ...buildHistoryRoutes(controllers),
    ...buildAnnuityRoutes(controllers)
  ];
}

export { buildDefaultRoutes };
