import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { registerActionDefinitions } from "@jskit-ai/kernel/server/actions";
import { createRepository as createCrudRepository } from "./repository.js";
import { createService as createCrudService } from "./service.js";
import { createActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";

const CRUD_TOKEN_SEGMENT = "${option:namespace|snake|default(crud)}";
const CRUD_PROVIDER_ID = `crud.${CRUD_TOKEN_SEGMENT}`;
const CRUD_ACTION_ID_PREFIX = `crud.${CRUD_TOKEN_SEGMENT}`;
const CRUD_CONTRIBUTOR_ID = `crud.${CRUD_TOKEN_SEGMENT}`;
const CRUD_ACTION_DEFINITIONS_TOKEN = `${CRUD_CONTRIBUTOR_ID}.actionDefinitions`;
const CRUD_REPOSITORY_TOKEN = `repository.${CRUD_TOKEN_SEGMENT}`;
const CRUD_SERVICE_TOKEN = `crud.${CRUD_TOKEN_SEGMENT}`;
const CRUD_TABLE_NAME = `crud_${CRUD_TOKEN_SEGMENT}`;

class CrudServiceProvider {
  static id = CRUD_PROVIDER_ID;

  static dependsOn = ["runtime.actions", "runtime.database", "auth.policy.fastify", "users.core"];

  register() {}

  boot(app) {
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

    registerActionDefinitions(app, CRUD_ACTION_DEFINITIONS_TOKEN, {
      contributorId: CRUD_CONTRIBUTOR_ID,
      domain: "crud",
      dependencies: {
        crudService: CRUD_SERVICE_TOKEN
      },
      actions: createActions({
        actionIdPrefix: CRUD_ACTION_ID_PREFIX
      })
    });

    registerRoutes(app);
  }
}

export { CrudServiceProvider };
