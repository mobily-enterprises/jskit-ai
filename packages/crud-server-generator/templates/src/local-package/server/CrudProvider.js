import { resolveAppConfig } from "@jskit-ai/kernel/server/support";
import { resolveCrudSurfacePolicyFromAppConfig } from "@jskit-ai/crud-core/server/crudModuleConfig";
import { createCrudJsonApiServiceEvents } from "@jskit-ai/crud-core/server/serviceEvents";
import {
  INTERNAL_JSON_REST_API,
  addResourceIfMissing,
  createJsonRestResourceScopeOptions
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { toDatabaseDateTimeUtc } from "@jskit-ai/database-runtime/shared";
import { createRepository } from "./repository.js";
import { createService } from "./service.js";
import { createActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import { resource } from "../shared/${option:namespace|singular|camel}Resource.js";
const CRUD_MODULE_CONFIG = Object.freeze({
  namespace: "${option:namespace|snake}",
  surface: __JSKIT_CRUD_SURFACE_ID__,
  ownershipFilter: "__JSKIT_CRUD_RESOLVED_OWNERSHIP_FILTER__",
  relativePath: "/${option:directory-prefix|pathprefix}${option:namespace|kebab}"
});
const baseServiceEvents = createCrudJsonApiServiceEvents(CRUD_MODULE_CONFIG.namespace);
const serviceEvents = {
  ...baseServiceEvents
};

function resolveCrudPolicyFromApp(app) {
  return resolveCrudSurfacePolicyFromAppConfig(CRUD_MODULE_CONFIG, resolveAppConfig(app), {
    context: "${option:namespace|pascal}Provider"
  });
}

class ${option:namespace|pascal}Provider {
  static id = "crud.${option:namespace|snake}";

  static dependsOn = ["runtime.actions", "runtime.database", "auth.policy.fastify", "local.main", "json-rest-api.core"];

  register(app) {
    const crudPolicy = resolveCrudPolicyFromApp(app);

    app.singleton("repository.${option:namespace|snake}", (scope) => {
      const api = scope.make(INTERNAL_JSON_REST_API);
      const knex = scope.make("jskit.database.knex");
      return createRepository({
        api,
        knex
      });
    });

    app.service(
      "crud.${option:namespace|snake}",
      (scope) => {
        return createService({
          ${option:namespace|camel}Repository: scope.make("repository.${option:namespace|snake}")
        });
      },
      {
        events: serviceEvents
      }
    );

    app.actions(
      withActionDefaults(
        createActions({
          surface: crudPolicy.surfaceId
        }),
        {
          domain: "crud",
          dependencies: {
            ${option:namespace|camel}Service: "crud.${option:namespace|snake}"
          }
        }
      )
    );
  }

  async boot(app) {
    const crudPolicy = resolveCrudPolicyFromApp(app);
    const api = app.make(INTERNAL_JSON_REST_API);
    await addResourceIfMissing(
      api,
      __JSKIT_CRUD_JSONREST_SCOPE_NAME__,
      createJsonRestResourceScopeOptions(resource, {
        writeSerializers: {
          "datetime-utc": toDatabaseDateTimeUtc
        }
      })
    );
    registerRoutes(app, {
      routeOwnershipFilter: crudPolicy.ownershipFilter,
      routeSurface: crudPolicy.surfaceId,
      routeSurfaceRequiresWorkspace: crudPolicy.surfaceDefinition.requiresWorkspace === true,
      routeRelativePath: crudPolicy.relativePath
    });
  }
}

export { ${option:namespace|pascal}Provider };
