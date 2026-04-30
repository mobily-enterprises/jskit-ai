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
import { actionIds } from "./actionIds.js";
import { LIST_CONFIG } from "./listConfig.js";
__JSKIT_CRUD_ACTION_WORKSPACE_VALIDATOR_IMPORT__

const listCursorPaginationQueryValidator = createCrudCursorPaginationQueryValidator(LIST_CONFIG);
const listParentFilterQueryValidator = createCrudParentFilterQueryValidator(resource);
__JSKIT_CRUD_ACTION_PERMISSION_SUPPORT__

function requireActionSurface(surface = "") {
  const normalizedSurface = String(surface || "").trim().toLowerCase();
  if (!normalizedSurface) {
    throw new TypeError("createActions requires a non-empty surface.");
  }

  return normalizedSurface;
}

function createActions({ surface = "" } = {}) {
  const actionSurface = requireActionSurface(surface);

  return Object.freeze([
    {
      id: actionIds.list,
      version: 1,
      kind: "query",
      channels: ["api", "automation", "internal"],
      surfaces: [actionSurface],
      permission: __JSKIT_CRUD_LIST_ACTION_PERMISSION__,
      input: __JSKIT_CRUD_LIST_ACTION_INPUT__,
      output: resource.operations.list.output,
      idempotency: "none",
      audit: {
        actionName: actionIds.list
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.${option:namespace|camel}Service.listRecords(input, {
          context,
          visibilityContext: context?.visibilityContext
        });
      }
    },
    {
      id: actionIds.view,
      version: 1,
      kind: "query",
      channels: ["api", "automation", "internal"],
      surfaces: [actionSurface],
      permission: __JSKIT_CRUD_VIEW_ACTION_PERMISSION__,
      input: __JSKIT_CRUD_VIEW_ACTION_INPUT__,
      output: resource.operations.view.output,
      idempotency: "none",
      audit: {
        actionName: actionIds.view
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.${option:namespace|camel}Service.getRecord(input.recordId, {
          context,
          visibilityContext: context?.visibilityContext,
          include: input.include
        });
      }
    },
    {
      id: actionIds.create,
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: [actionSurface],
      permission: __JSKIT_CRUD_CREATE_ACTION_PERMISSION__,
      input: __JSKIT_CRUD_CREATE_ACTION_INPUT__,
      output: resource.operations.create.output,
      idempotency: "optional",
      audit: {
        actionName: actionIds.create
      },
      observability: {},
      async execute(input, context, deps) {
        const { workspaceSlug, ...payload } = input || {};
        return deps.${option:namespace|camel}Service.createRecord(payload, {
          context,
          visibilityContext: context?.visibilityContext
        });
      }
    },
    {
      id: actionIds.update,
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: [actionSurface],
      permission: __JSKIT_CRUD_UPDATE_ACTION_PERMISSION__,
      input: __JSKIT_CRUD_UPDATE_ACTION_INPUT__,
      output: resource.operations.patch.output,
      idempotency: "optional",
      audit: {
        actionName: actionIds.update
      },
      observability: {},
      async execute(input, context, deps) {
        const { workspaceSlug, recordId, ...patch } = input || {};
        return deps.${option:namespace|camel}Service.updateRecord(recordId, patch, {
          context,
          visibilityContext: context?.visibilityContext
        });
      }
    },
    {
      id: actionIds.delete,
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: [actionSurface],
      permission: __JSKIT_CRUD_DELETE_ACTION_PERMISSION__,
      input: __JSKIT_CRUD_DELETE_ACTION_INPUT__,
      output: resource.operations.delete.output,
      idempotency: "optional",
      audit: {
        actionName: actionIds.delete
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.${option:namespace|camel}Service.deleteRecord(input.recordId, {
          context,
          visibilityContext: context?.visibilityContext
        });
      }
    }
  ]);
}

export { createActions };
