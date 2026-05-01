import {
  composeSchemaDefinitions,
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/validators";
import {
  createCrudCursorPaginationQueryValidator,
  listSearchQueryValidator
} from "@jskit-ai/crud-core/server/listQueryValidators";
import { workspaceSlugParamsValidator } from "@jskit-ai/workspaces-core/server/validators/routeParamsValidator";
import { resource } from "../shared/userResource.js";

const listCursorPaginationQueryValidator = createCrudCursorPaginationQueryValidator({
  orderBy: resource.defaultSort
});
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
        workspaceSlugParamsValidator,
        listCursorPaginationQueryValidator,
        listSearchQueryValidator
      ]),
      output: null,
      idempotency: "none",
      audit: {
        actionName: "crud.users.list"
      },
      observability: {},
      async execute(input, context, deps) {
        const { workspaceSlug, ...query } = input || {};
        return deps.usersService.queryDocuments(query, {
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
        workspaceSlugParamsValidator,
        recordIdParamsValidator
      ]),
      output: null,
      idempotency: "none",
      audit: {
        actionName: "crud.users.view"
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.usersService.getDocumentById(input.recordId, {
          context,
          visibilityContext: context?.visibilityContext
        });
      }
    }
  ]);
}

export { createActions };
