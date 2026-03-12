import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { registerActionDefinitions } from "@jskit-ai/kernel/server/actions";
import { createRepository as createCrudRepository } from "./repository.js";
import { createService as createCrudService } from "./service.js";
import { createActions, createActionIds } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import { resolveCrudConfigsFromModules } from "../shared/crud/crudModuleConfig.js";

function resolveCrudModuleConfigs(app) {
  const appConfig = app.has("appConfig") ? app.make("appConfig") : {};
  const resolved = resolveCrudConfigsFromModules(appConfig?.modules);
  if (resolved.length > 0) {
    return resolved;
  }

  throw new Error('CrudServiceProvider requires config.modules entries with module: "crud".');
}

class CrudServiceProvider {
  static id = "crud";

  static dependsOn = ["runtime.actions", "runtime.database", "auth.policy.fastify", "users.core"];

  register() {}

  boot(app) {
    const crudConfigs = resolveCrudModuleConfigs(app);

    for (const crudConfig of crudConfigs) {
      app.singleton(crudConfig.repositoryToken, (scope) => {
        const knex = scope.make(KERNEL_TOKENS.Knex);
        return createCrudRepository(knex, {
          tableName: crudConfig.tableName
        });
      });
      app.singleton(crudConfig.serviceToken, (scope) => {
        return createCrudService({
          crudRepository: scope.make(crudConfig.repositoryToken)
        });
      });
      registerActionDefinitions(app, crudConfig.actionDefinitionsToken, {
        contributorId: crudConfig.contributorId,
        domain: crudConfig.domain,
        dependencies: {
          crudService: crudConfig.serviceToken
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
}

export { CrudServiceProvider };
