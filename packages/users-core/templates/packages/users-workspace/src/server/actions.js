import {
  composeSchemaDefinitions,
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/validators";
import {
  createStandardCrudListQueryValidators,
  createStandardCrudViewQueryValidators
} from "@jskit-ai/crud-core/server/listQueryValidators";
import { workspaceSlugParamsValidator } from "@jskit-ai/workspaces-core/server/validators/routeParamsValidator";
import { resource } from "../shared/userResource.js";

const authenticatedPermission = Object.freeze({
  require: "authenticated"
});

function buildListQuery(input = {}) {
  const query = { ...(input || {}) };
  delete query.workspaceSlug;
  return query;
}

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
        ...createStandardCrudListQueryValidators({ resource })
      ]),
      output: null,
      idempotency: "none",
      audit: {
        actionName: "crud.users.list"
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.usersService.queryDocuments(buildListQuery(input), {
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
        const { workspaceSlug, recordId, ...query } = input || {};
        return deps.usersService.getDocumentById(recordId, query, {
          context,
          visibilityContext: context?.visibilityContext
        });
      }
    }
  ]);
}

export { createActions };
