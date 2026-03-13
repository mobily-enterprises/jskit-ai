import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { createRepository as createCrudRepository } from "./repository.js";
import { createService as createCrudService } from "./service.js";
import { createActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";

const CRUD_TOKEN_SEGMENT = "${option:namespace|snake|default(crud)}";
const CRUD_PROVIDER_ID = `crud.${CRUD_TOKEN_SEGMENT}`;
const CRUD_ACTION_ID_PREFIX = `crud.${CRUD_TOKEN_SEGMENT}`;
const CRUD_REPOSITORY_TOKEN = `repository.${CRUD_TOKEN_SEGMENT}`;
const CRUD_SERVICE_TOKEN = `crud.${CRUD_TOKEN_SEGMENT}`;
const CRUD_TABLE_NAME = `crud_${CRUD_TOKEN_SEGMENT}`;

class CrudServiceProvider {
  static id = CRUD_PROVIDER_ID;

  static dependsOn = ["runtime.actions", "runtime.database", "auth.policy.fastify", "users.core"];

  register() {}

  boot(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.actions !== "function") {
      throw new Error("CrudServiceProvider requires application singleton()/actions().");
    }

    app.singleton(CRUD_REPOSITORY_TOKEN, (scope) => {
      const knex = scope.make(KERNEL_TOKENS.Knex);
      return createCrudRepository(knex, {
        tableName: CRUD_TABLE_NAME
      });
    });

    app.singleton(CRUD_SERVICE_TOKEN, (scope) => {
      return createCrudService({
        crudRepository: scope.make(CRUD_REPOSITORY_TOKEN)
      });
    });

    app.actions(
      withActionDefaults(
        createActions({
          actionIdPrefix: CRUD_ACTION_ID_PREFIX
        }),
        {
          domain: "crud",
          dependencies: {
            crudService: CRUD_SERVICE_TOKEN
          }
        }
      )
    );

    registerRoutes(app);
  }
}

export { CrudServiceProvider };
