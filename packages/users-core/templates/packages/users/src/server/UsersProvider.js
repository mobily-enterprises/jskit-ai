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

  static dependsOn = ["runtime.actions", "runtime.database", "auth.policy.fastify", "local.main"];

  register(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.service !== "function" || typeof app.actions !== "function") {
      throw new Error("UsersProvider requires application singleton()/service()/actions().");
    }

    const crudPolicy = resolveCrudPolicyFromApp(app);

    app.singleton("repository.users", (scope) => {
      const knex = scope.make("jskit.database.knex");
      return createRepository(knex, {
        resolveLookup: createCrudLookupResolver(scope)
      });
    });

    app.singleton("lookup.users", (scope) => {
      return createCrudLookup(scope.make("repository.users"), {
        ownershipFilter: crudPolicy.ownershipFilter
      });
    });

    app.service(
      "crud.users",
      (scope) => {
        return createService({
          usersRepository: scope.make("repository.users")
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
            usersService: "crud.users"
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

export { UsersProvider };
