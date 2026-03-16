import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import {
  createToolArgsSchema,
  cursorPaginationQueryValidator,
  positiveIntegerValidator
} from "@jskit-ai/kernel/shared/validators";
import { createRepository } from "./repository.js";
import {
  createService,
  servicePermissions,
  serviceEvents
} from "./service.js";
import { crudResource } from "../shared/crudResource.js";
import { createActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import {
  NAMESPACE_${option:namespace|snake|upper}_REPOSITORY_TOKEN,
  NAMESPACE_${option:namespace|snake|upper}_SERVICE_TOKEN
} from "./diTokens.js";

const NAMESPACE_${option:namespace|snake|upper}_PROVIDER_ID = NAMESPACE_${option:namespace|snake|upper}_SERVICE_TOKEN;
const NAMESPACE_${option:namespace|snake|upper}_TABLE_NAME = "crud_${option:namespace|snake}";

const CRUD_SERVICE_SCHEMAS = Object.freeze({
  listRecords: Object.freeze({
    description: "List records with cursor pagination.",
    input: Object.freeze({
      schema: createToolArgsSchema([cursorPaginationQueryValidator.schema], {
        minItems: 0,
        maxItems: 1
      })
    }),
    output: crudResource.operations.list.outputValidator
  }),
  getRecord: Object.freeze({
    description: "Load one record by id.",
    input: Object.freeze({
      schema: createToolArgsSchema([positiveIntegerValidator.schema], {
        minItems: 1,
        maxItems: 1
      })
    }),
    output: crudResource.operations.view.outputValidator
  }),
  createRecord: Object.freeze({
    description: "Create one record.",
    input: Object.freeze({
      schema: createToolArgsSchema([crudResource.operations.create.bodyValidator.schema], {
        minItems: 1,
        maxItems: 1
      })
    }),
    output: crudResource.operations.create.outputValidator
  }),
  updateRecord: Object.freeze({
    description: "Update one record by id.",
    input: Object.freeze({
      schema: createToolArgsSchema(
        [positiveIntegerValidator.schema, crudResource.operations.patch.bodyValidator.schema],
        {
          minItems: 2,
          maxItems: 2
        }
      )
    }),
    output: crudResource.operations.patch.outputValidator
  }),
  deleteRecord: Object.freeze({
    description: "Delete one record by id.",
    input: Object.freeze({
      schema: createToolArgsSchema([positiveIntegerValidator.schema], {
        minItems: 1,
        maxItems: 1
      })
    }),
    output: crudResource.operations.delete.outputValidator
  })
});

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
        permissions: servicePermissions,
        events: serviceEvents,
        schemas: CRUD_SERVICE_SCHEMAS
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
