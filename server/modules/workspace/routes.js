import { schema } from "./schemas.js";
import { buildRoutes as buildBootstrapRoutes } from "./routes/bootstrap.routes.js";
import { buildRoutes as buildSelfServiceRoutes } from "./routes/selfService.routes.js";
import { buildRoutes as buildAdminRoutes } from "./routes/admin.routes.js";

function buildRoutes(controllers, { missingHandler }) {
  return [
    ...buildBootstrapRoutes(controllers, { missingHandler, schema }),
    ...buildSelfServiceRoutes(controllers, { missingHandler, schema }),
    ...buildAdminRoutes(controllers, { missingHandler, schema })
  ];
}

export { buildRoutes };
