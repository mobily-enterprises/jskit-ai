import {
  composeSchemaDefinitions,
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/validators";
import {
  createStandardCrudListQueryValidators,
  createStandardCrudViewQueryValidators
} from "@jskit-ai/crud-core/server/listQueryValidators";
import { resource } from "../shared/userResource.js";

const authenticatedPermission = Object.freeze({
  require: "authenticated"
});

function createActions({ surface } = {}) {
  return Object.freeze([
    {
      id: "crud.users.list",
      version: 1,
      kind: "query",
      channels: ["api", "automation", "internal"],
      surfaces: [surface],
      permission: authenticatedPermission,
      input: composeSchemaDefinitions([
        ...createStandardCrudListQueryValidators({ resource })
      ]),
      output: null,
      idempotency: "none",
      audit: {
        actionName: "crud.users.list"
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.usersService.queryDocuments(input || {}, {
          context,
          visibilityContext: context?.visibilityContext
        });
      }
    },
    {
      id: "crud.users.view",
      version: 1,
      kind: "query",
      channels: ["api", "automation", "internal"],
      surfaces: [surface],
      permission: authenticatedPermission,
      input: composeSchemaDefinitions([
        recordIdParamsValidator,
        ...createStandardCrudViewQueryValidators()
      ]),
      output: null,
      idempotency: "none",
      audit: {
        actionName: "crud.users.view"
      },
      observability: {},
      async execute(input, context, deps) {
        const { recordId, ...query } = input || {};
        return deps.usersService.getDocumentById(recordId, query, {
          context,
          visibilityContext: context?.visibilityContext
        });
      }
    }
  ]);
}

export { createActions };
