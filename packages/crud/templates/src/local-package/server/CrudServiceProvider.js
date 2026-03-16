import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { createRepository } from "./repository.js";
import {
  createService,
  serviceEvents
} from "./service.js";
import { createActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import {
  NAMESPACE_${option:namespace|snake|upper}_REPOSITORY_TOKEN,
  NAMESPACE_${option:namespace|snake|upper}_SERVICE_TOKEN
} from "./diTokens.js";

const NAMESPACE_${option:namespace|snake|upper}_PROVIDER_ID = NAMESPACE_${option:namespace|snake|upper}_SERVICE_TOKEN;
const NAMESPACE_${option:namespace|snake|upper}_TABLE_NAME = "crud_${option:namespace|snake}";

class ${option:namespace|pascal}ServiceProvider {
  static id = NAMESPACE_${option:namespace|snake|upper}_PROVIDER_ID;

  static dependsOn = ["runtime.actions", "runtime.database", "auth.policy.fastify", "users.core"];

  register(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.service !== "function" || typeof app.actions !== "function") {
      throw new Error("${option:namespace|pascal}ServiceProvider requires application singleton()/service()/actions().");
    }

    app.singleton(NAMESPACE_${option:namespace|snake|upper}_REPOSITORY_TOKEN, (scope) => {
      const knex = scope.make(KERNEL_TOKENS.Knex);
      return createRepository(knex, {
        tableName: NAMESPACE_${option:namespace|snake|upper}_TABLE_NAME
      });
    });

    app.service(
      NAMESPACE_${option:namespace|snake|upper}_SERVICE_TOKEN,
      (scope) => {
        return createService({
          ${option:namespace|camel}Repository: scope.make(NAMESPACE_${option:namespace|snake|upper}_REPOSITORY_TOKEN)
        });
      },
      {
        events: serviceEvents
      }
    );

    app.actions(
      withActionDefaults(
        createActions(),
        {
          domain: "crud",
          dependencies: {
            ${option:namespace|camel}Service: NAMESPACE_${option:namespace|snake|upper}_SERVICE_TOKEN
          }
        }
      )
    );
  }

  boot(app) {
    registerRoutes(app);
  }
}

export { ${option:namespace|pascal}ServiceProvider };
