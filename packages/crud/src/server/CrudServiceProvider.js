import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { registerActionDefinitions } from "@jskit-ai/kernel/server/actions";
import { createRepository as createContactsRepository } from "./contacts/contactsRepository.js";
import { createService as createContactsService } from "./contacts/contactsService.js";
import { createContactsActions, createContactsActionIds } from "./contacts/contactsActions.js";
import { registerContactsRoutes } from "./contacts/registerContactsRoutes.js";
import { resolveContactsConfig } from "../shared/contacts/contactsModuleConfig.js";

const CRUD_CONFIG_TOKEN = "crud.config";

function resolveCrudContactsConfig(app) {
  const appConfig = app.has("appConfig") ? app.make("appConfig") : {};
  return resolveContactsConfig(appConfig?.crud);
}

class CrudServiceProvider {
  static id = "crud";

  static dependsOn = ["runtime.actions", "runtime.database", "auth.policy.fastify", "users.core"];

  register(app) {
    const contactsConfig = resolveCrudContactsConfig(app);
    app.instance(CRUD_CONFIG_TOKEN, contactsConfig);

    app.singleton(contactsConfig.repositoryToken, (scope) => {
      const knex = scope.make(KERNEL_TOKENS.Knex);
      return createContactsRepository(knex, {
        tableName: contactsConfig.tableName
      });
    });

    app.singleton(contactsConfig.serviceToken, (scope) => {
      return createContactsService({
        contactsRepository: scope.make(contactsConfig.repositoryToken)
      });
    });

    registerActionDefinitions(app, contactsConfig.actionDefinitionsToken, {
      contributorId: contactsConfig.contributorId,
      domain: contactsConfig.domain,
      dependencies: {
        contactsService: contactsConfig.serviceToken
      },
      actions: createContactsActions({
        actionIdPrefix: contactsConfig.actionIdPrefix
      })
    });
  }

  boot(app) {
    const contactsConfig = app.make(CRUD_CONFIG_TOKEN);
    registerContactsRoutes(app, {
      routeBasePath: contactsConfig.apiBasePath,
      routeVisibility: contactsConfig.visibility,
      actionIds: createContactsActionIds(contactsConfig.actionIdPrefix)
    });
  }
}

export { CrudServiceProvider };
