import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { registerActionDefinitions } from "@jskit-ai/kernel/server/actions";
import { createRepository as createCrudRepository } from "./repository.js";
import { createService as createCrudService } from "./service.js";
import { createActions, createActionIds } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import { resolveContactsConfig } from "../shared/contacts/contactsModuleConfig.js";

const CRUD_CONFIG_TOKEN = "crud.config";

function resolveCrudContactsConfig(app) {
  const appConfig = app.has("appConfig") ? app.make("appConfig") : {};
  return resolveContactsConfig(appConfig?.crud);
}

class CrudServiceProvider {
  static id = "crud";

  static dependsOn = ["runtime.actions", "runtime.database", "auth.policy.fastify", "users.core"];

  register() {}

  boot(app) {
    const crudConfig = resolveCrudContactsConfig(app);
    app.instance(CRUD_CONFIG_TOKEN, crudConfig);

    app.singleton(crudConfig.repositoryToken, (scope) => {
      const knex = scope.make(KERNEL_TOKENS.Knex);
      return createCrudRepository(knex, {
        tableName: crudConfig.tableName
      });
    });

    app.singleton(crudConfig.serviceToken, (scope) => {
      return createCrudService({
        contactsRepository: scope.make(crudConfig.repositoryToken)
      });
    });

    registerActionDefinitions(app, crudConfig.actionDefinitionsToken, {
      contributorId: crudConfig.contributorId,
      domain: crudConfig.domain,
      dependencies: {
        contactsService: crudConfig.serviceToken
      },
      actions: createActions({
        actionIdPrefix: crudConfig.actionIdPrefix
      })
    });
    registerRoutes(app, {
      routeBasePath: crudConfig.apiBasePath,
      routeVisibility: crudConfig.visibility,
      actionIds: createActionIds(crudConfig.actionIdPrefix)
    });
  }
}

export { CrudServiceProvider };
