import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { registerActionDefinitions } from "@jskit-ai/kernel/server/actions";
import { createRepository as createCrudRepository } from "./repository.js";
import { createService as createCrudService } from "./service.js";
import { createActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import { crudModuleConfig } from "../shared/moduleConfig.js";

class CrudServiceProvider {
  static id = `crud.${crudModuleConfig.namespace || "default"}`;

  static dependsOn = ["runtime.actions", "runtime.database", "auth.policy.fastify", "users.core"];

  register() {}

  boot(app) {
    app.singleton(crudModuleConfig.repositoryToken, (scope) => {
      const knex = scope.make(KERNEL_TOKENS.Knex);
      return createCrudRepository(knex, {
        tableName: crudModuleConfig.tableName
      });
    });

    app.singleton(crudModuleConfig.serviceToken, (scope) => {
      return createCrudService({
        crudRepository: scope.make(crudModuleConfig.repositoryToken)
      });
    });

    registerActionDefinitions(app, crudModuleConfig.actionDefinitionsToken, {
      contributorId: crudModuleConfig.contributorId,
      domain: crudModuleConfig.domain,
      dependencies: {
        crudService: crudModuleConfig.serviceToken
      },
      actions: createActions({
        actionIdPrefix: crudModuleConfig.actionIdPrefix
      })
    });

    registerRoutes(app, {
      routeBasePath: crudModuleConfig.apiBasePath,
      routeVisibility: crudModuleConfig.visibility
    });
  }
}

export { CrudServiceProvider };
