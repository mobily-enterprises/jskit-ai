import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { registerActionDefinitions } from "@jskit-ai/kernel/server/actions";
import { createRepository as createContactsRepository } from "./contacts/contactsRepository.js";
import { createService as createContactsService } from "./contacts/contactsService.js";
import { contactsActions } from "./contacts/contactsActions.js";
import { registerContactsRoutes } from "./contacts/registerContactsRoutes.js";

const CRUD_CONTACTS_ACTIONS_TOKEN = "crud.contacts.actionDefinitions";

class CrudServiceProvider {
  static id = "crud.contacts";

  static dependsOn = ["runtime.actions", "runtime.database", "auth.policy.fastify"];

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("CrudServiceProvider requires application singleton().");
    }

    app.singleton("crud.contacts.repository", (scope) => {
      const knex = scope.make(KERNEL_TOKENS.Knex);
      return createContactsRepository(knex);
    });

    app.singleton("crud.contacts.service", (scope) => {
      return createContactsService({
        contactsRepository: scope.make("crud.contacts.repository")
      });
    });

    registerActionDefinitions(app, CRUD_CONTACTS_ACTIONS_TOKEN, {
      contributorId: "crud.contacts",
      domain: "contacts",
      dependencies: {
        contactsService: "crud.contacts.service"
      },
      actions: contactsActions
    });
  }

  boot(app) {
    registerContactsRoutes(app);
  }
}

export { CrudServiceProvider };
