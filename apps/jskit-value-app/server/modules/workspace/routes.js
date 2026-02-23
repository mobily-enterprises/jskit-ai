import { schema } from "./schema.js";
import { buildRoutes as buildBootstrapRoutes } from "./routes/bootstrap.route.js";
import { buildRoutes as buildSelfServiceRoutes } from "./routes/selfService.route.js";
import { buildRoutes as buildAdminRoutes } from "./routes/admin.route.js";

function buildRoutes(controllers, { missingHandler }) {
  return [
    ...buildBootstrapRoutes(controllers, { missingHandler, schema }),
    ...buildSelfServiceRoutes(controllers, { missingHandler, schema }),
    ...buildAdminRoutes(controllers, { missingHandler, schema })
  ];
}

export { buildRoutes };
