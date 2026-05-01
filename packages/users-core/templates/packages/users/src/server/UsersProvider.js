import { resolveAppConfig } from "@jskit-ai/kernel/server/support";
import { resolveCrudSurfacePolicyFromAppConfig } from "@jskit-ai/crud-core/server/crudModuleConfig";
import { INTERNAL_JSON_REST_API, addResourceIfMissing } from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { createRepository } from "./repository.js";
import { createService } from "./service.js";
import { createActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import { jsonRestResource } from "./jsonRestResource.js";

const CRUD_MODULE_CONFIG = Object.freeze({
  namespace: "users",
  surface: "home",
  ownershipFilter: "public",
  relativePath: "/users"
});

function resolveCrudPolicyFromApp(app) {
  return resolveCrudSurfacePolicyFromAppConfig(CRUD_MODULE_CONFIG, resolveAppConfig(app), {
    context: "UsersProvider"
  });
}

class UsersProvider {
  static id = "crud.users";

  static dependsOn = ["runtime.actions", "runtime.database", "auth.policy.fastify", "local.main", "json-rest-api.core"];

  register(app) {
    const crudPolicy = resolveCrudPolicyFromApp(app);

    app.singleton("repository.users", (scope) => {
      const api = scope.make(INTERNAL_JSON_REST_API);
      const knex = scope.make("jskit.database.knex");
      return createRepository({
        api,
        knex
      });
    });

    app.service(
      "crud.users",
      (scope) => {
        return createService({
          usersRepository: scope.make("repository.users")
        });
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
            usersService: "crud.users"
          }
        }
      )
    );
  }

  async boot(app) {
    const crudPolicy = resolveCrudPolicyFromApp(app);
    const api = app.make(INTERNAL_JSON_REST_API);
    await addResourceIfMissing(api, "users", jsonRestResource);
    registerRoutes(app, {
      routeOwnershipFilter: crudPolicy.ownershipFilter,
      routeSurface: crudPolicy.surfaceId,
      routeRelativePath: crudPolicy.relativePath
    });
  }
}

export { UsersProvider };
