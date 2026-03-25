import { resolveAppConfig } from "@jskit-ai/kernel/server/support";
import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { createRepository } from "./repository.js";
import {
  createService,
  serviceEvents
} from "./service.js";
import { createActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import {
  crudModuleConfig,
  resolveCrudModulePolicyFromAppConfig
} from "../shared/moduleConfig.js";
const NAMESPACE_${option:namespace|snake|upper}_TABLE_NAME = "crud_${option:namespace|snake}";

function resolveCrudPolicyFromApp(app) {
  return resolveCrudModulePolicyFromAppConfig(resolveAppConfig(app), {
    moduleConfig: crudModuleConfig,
    context: "${option:namespace|pascal}ServiceProvider"
  });
}

class ${option:namespace|pascal}ServiceProvider {
  static id = "crud.${option:namespace|snake}";

  static dependsOn = ["runtime.actions", "runtime.database", "auth.policy.fastify", "local.main", "users.core"];

  register(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.service !== "function" || typeof app.actions !== "function") {
      throw new Error("${option:namespace|pascal}ServiceProvider requires application singleton()/service()/actions().");
    }

    const crudPolicy = resolveCrudPolicyFromApp(app);

    app.singleton("repository.${option:namespace|snake}", (scope) => {
      const knex = scope.make("jskit.database.knex");
      return createRepository(knex, {
        tableName: NAMESPACE_${option:namespace|snake|upper}_TABLE_NAME
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
      routeSurfaceRequiresWorkspace: crudPolicy.surfaceDefinition.requiresWorkspace === true,
      routeRelativePath: crudPolicy.relativePath
    });
  }
}

export { ${option:namespace|pascal}ServiceProvider };
