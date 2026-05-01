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
import { jsonRestResource } from "./jsonRestResource.js";
import { actionIds } from "./actionIds.js";
__JSKIT_CRUD_ACTION_WORKSPACE_VALIDATOR_IMPORT__

const listCursorPaginationQueryValidator = createCrudCursorPaginationQueryValidator({
  orderBy: jsonRestResource.defaultSort
});
const listParentFilterQueryValidator = createCrudParentFilterQueryValidator(resource);
__JSKIT_CRUD_ACTION_PERMISSION_SUPPORT__

function createActions({ surface } = {}) {
  return Object.freeze([
    {
      id: actionIds.list,
      version: 1,
      kind: "query",
      channels: ["api", "automation", "internal"],
      surfaces: [surface],
      permission: __JSKIT_CRUD_LIST_ACTION_PERMISSION__,
      input: __JSKIT_CRUD_LIST_ACTION_INPUT__,
      output: null,
      idempotency: "none",
      audit: {
        actionName: actionIds.list
      },
      observability: {},
      async execute(input, context, deps) {
        const { workspaceSlug, ...query } = input || {};
        return deps.${option:namespace|camel}Service.listRecords(query, {
          context
        });
      }
    },
    {
      id: actionIds.view,
      version: 1,
      kind: "query",
      channels: ["api", "automation", "internal"],
      surfaces: [surface],
      permission: __JSKIT_CRUD_VIEW_ACTION_PERMISSION__,
      input: __JSKIT_CRUD_VIEW_ACTION_INPUT__,
      output: null,
      idempotency: "none",
      audit: {
        actionName: actionIds.view
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.${option:namespace|camel}Service.getRecord(input.recordId, {
          context,
          include: input.include
        });
      }
    },
    {
      id: actionIds.create,
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: [surface],
      permission: __JSKIT_CRUD_CREATE_ACTION_PERMISSION__,
      input: __JSKIT_CRUD_CREATE_ACTION_INPUT__,
      output: null,
      idempotency: "optional",
      audit: {
        actionName: actionIds.create
      },
      observability: {},
      async execute(input, context, deps) {
        const { workspaceSlug, ...payload } = input || {};
        return deps.${option:namespace|camel}Service.createRecord(payload, {
          context
        });
      }
    },
    {
      id: actionIds.update,
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: [surface],
      permission: __JSKIT_CRUD_UPDATE_ACTION_PERMISSION__,
      input: __JSKIT_CRUD_UPDATE_ACTION_INPUT__,
      output: null,
      idempotency: "optional",
      audit: {
        actionName: actionIds.update
      },
      observability: {},
      async execute(input, context, deps) {
        const { workspaceSlug, recordId, ...patch } = input || {};
        return deps.${option:namespace|camel}Service.updateRecord(recordId, patch, {
          context
        });
      }
    },
    {
      id: actionIds.delete,
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: [surface],
      permission: __JSKIT_CRUD_DELETE_ACTION_PERMISSION__,
      input: __JSKIT_CRUD_DELETE_ACTION_INPUT__,
      output: null,
      idempotency: "optional",
      audit: {
        actionName: actionIds.delete
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.${option:namespace|camel}Service.deleteRecord(input.recordId, {
          context
        });
      }
    }
  ]);
}

export { createActions };
