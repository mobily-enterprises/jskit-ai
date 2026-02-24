import { schema } from "../schemas/index.js";
import { buildRoutes as buildAdminRoutes } from "./admin.routes.js";
import { buildRoutes as buildBootstrapRoutes } from "./bootstrap.routes.js";
import { buildRoutes as buildSelfServiceRoutes } from "./selfService.routes.js";

function createMissingHandler() {
  return async (_request, reply) => {
    reply.code(501).send({
      error: "Endpoint is not available in this server wiring."
    });
  };
}

function buildRoutes(controllers, options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const missingHandler = typeof source.missingHandler === "function" ? source.missingHandler : createMissingHandler();
  const workspaceSchema = source.schema && typeof source.schema === "object" ? source.schema : schema;

  return [
    ...buildBootstrapRoutes(controllers, {
      missingHandler,
      schema: workspaceSchema.bootstrap
    }),
    ...buildSelfServiceRoutes(controllers, {
      missingHandler,
      schema: workspaceSchema.selfService
    }),
    ...buildAdminRoutes(controllers, {
      missingHandler,
      schema: workspaceSchema.admin
    })
  ];
}

export { buildRoutes };
