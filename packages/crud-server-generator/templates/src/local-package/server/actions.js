import {
  composeSchemaDefinitions,
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/validators";
import {
  createCrudCursorPaginationQueryValidator,
  listSearchQueryValidator,
  lookupIncludeQueryValidator,
  createCrudParentFilterQueryValidator
} from "@jskit-ai/crud-core/server/listQueryValidators";
import { resource } from "../shared/${option:namespace|singular|camel}Resource.js";
__JSKIT_CRUD_ACTION_WORKSPACE_VALIDATOR_IMPORT__

const listCursorPaginationQueryValidator = createCrudCursorPaginationQueryValidator({
  orderBy: resource.defaultSort
});
const listParentFilterQueryValidator = createCrudParentFilterQueryValidator(resource);
__JSKIT_CRUD_ACTION_PERMISSION_SUPPORT__

function createActions({ surface } = {}) {
  return Object.freeze([
    {
      id: "crud.${option:namespace|snake}.list",
      version: 1,
      kind: "query",
      channels: ["api", "automation", "internal"],
      surfaces: [surface],
      permission: __JSKIT_CRUD_LIST_ACTION_PERMISSION__,
      input: __JSKIT_CRUD_LIST_ACTION_INPUT__,
      output: null,
      idempotency: "none",
      audit: {
        actionName: "crud.${option:namespace|snake}.list"
      },
      observability: {},
      async execute(input, context, deps) {
        const { workspaceSlug, ...query } = input || {};
        return deps.${option:namespace|camel}Service.queryDocuments(query, {
          context
        });
      }
    },
    {
      id: "crud.${option:namespace|snake}.view",
      version: 1,
      kind: "query",
      channels: ["api", "automation", "internal"],
      surfaces: [surface],
      permission: __JSKIT_CRUD_VIEW_ACTION_PERMISSION__,
      input: __JSKIT_CRUD_VIEW_ACTION_INPUT__,
      output: null,
      idempotency: "none",
      audit: {
        actionName: "crud.${option:namespace|snake}.view"
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.${option:namespace|camel}Service.getDocumentById(input.recordId, {
          context,
          include: input.include
        });
      }
    },
    {
      id: "crud.${option:namespace|snake}.create",
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: [surface],
      permission: __JSKIT_CRUD_CREATE_ACTION_PERMISSION__,
      input: __JSKIT_CRUD_CREATE_ACTION_INPUT__,
      output: null,
      idempotency: "optional",
      audit: {
        actionName: "crud.${option:namespace|snake}.create"
      },
      observability: {},
      async execute(input, context, deps) {
        const { workspaceSlug, ...payload } = input || {};
        return deps.${option:namespace|camel}Service.createDocument(payload, {
          context
        });
      }
    },
    {
      id: "crud.${option:namespace|snake}.update",
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: [surface],
      permission: __JSKIT_CRUD_UPDATE_ACTION_PERMISSION__,
      input: __JSKIT_CRUD_UPDATE_ACTION_INPUT__,
      output: null,
      idempotency: "optional",
      audit: {
        actionName: "crud.${option:namespace|snake}.update"
      },
      observability: {},
      async execute(input, context, deps) {
        const { workspaceSlug, recordId, ...patch } = input || {};
        return deps.${option:namespace|camel}Service.patchDocumentById(recordId, patch, {
          context
        });
      }
    },
    {
      id: "crud.${option:namespace|snake}.delete",
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: [surface],
      permission: __JSKIT_CRUD_DELETE_ACTION_PERMISSION__,
      input: __JSKIT_CRUD_DELETE_ACTION_INPUT__,
      output: null,
      idempotency: "optional",
      audit: {
        actionName: "crud.${option:namespace|snake}.delete"
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.${option:namespace|camel}Service.deleteDocumentById(input.recordId, {
          context
        });
      }
    }
  ]);
}

export { createActions };
