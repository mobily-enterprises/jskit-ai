import { resolveAppConfig } from "@jskit-ai/kernel/server/support";
import { resolveCrudSurfacePolicyFromAppConfig } from "@jskit-ai/crud-core/server/crudModuleConfig";
import {
  createCrudLookupResolver,
  createCrudLookup
} from "@jskit-ai/crud-core/server/lookups";
import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { createRepository } from "./repository.js";
import {
  createService,
  serviceEvents
} from "./service.js";
import { createActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
const CRUD_MODULE_CONFIG = Object.freeze({
  namespace: "${option:namespace|snake}",
  surface: __JSKIT_CRUD_SURFACE_ID__,
  ownershipFilter: "__JSKIT_CRUD_RESOLVED_OWNERSHIP_FILTER__",
  relativePath: "/${option:directory-prefix|pathprefix}${option:namespace|kebab}"
});

function resolveCrudPolicyFromApp(app) {
  return resolveCrudSurfacePolicyFromAppConfig(CRUD_MODULE_CONFIG, resolveAppConfig(app), {
    context: "${option:namespace|pascal}Provider"
  });
}

class ${option:namespace|pascal}Provider {
  static id = "crud.${option:namespace|snake}";

  static dependsOn = ["runtime.actions", "runtime.database", "auth.policy.fastify", "local.main", "users.core"];

  register(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.service !== "function" || typeof app.actions !== "function") {
      throw new Error("${option:namespace|pascal}Provider requires application singleton()/service()/actions().");
    }

    const crudPolicy = resolveCrudPolicyFromApp(app);

    app.singleton("repository.${option:namespace|snake}", (scope) => {
      const knex = scope.make("jskit.database.knex");
      return createRepository(knex, {
        resolveLookup: createCrudLookupResolver(scope)
      });
    });

    app.singleton("lookup.${option:namespace|snake}", (scope) => {
      return createCrudLookup(scope.make("repository.${option:namespace|snake}"), {
        ownershipFilter: crudPolicy.ownershipFilter
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

  boot(app) {
    const crudPolicy = resolveCrudPolicyFromApp(app);
    registerRoutes(app, {
      routeOwnershipFilter: crudPolicy.ownershipFilter,
      routeSurface: crudPolicy.surfaceId,
      routeRelativePath: crudPolicy.relativePath
    });
  }
}

export { ${option:namespace|pascal}Provider };
