import {
  cursorPaginationQueryValidator,
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/validators";
import { routeParamsValidator } from "@jskit-ai/users-core/server/validators/routeParamsValidator";
import { crudResource } from "../shared/crudResource.js";
import { CRUD_ACTION_ID_PREFIX, createActionIds } from "./actionIds.js";

function createActions({ actionIdPrefix = CRUD_ACTION_ID_PREFIX } = {}) {
  const actionIds = createActionIds(actionIdPrefix);

  return Object.freeze([
    {
      id: actionIds.list,
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      consoleUsersOnly: false,
      inputValidator: [routeParamsValidator, cursorPaginationQueryValidator],
      outputValidator: crudResource.operations.list.outputValidator,
      idempotency: "none",
      audit: {
        actionName: actionIds.list
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.crudService.listRecords(input, {
          context,
          visibilityContext: context?.visibilityContext
        });
      }
    },
    {
      id: actionIds.view,
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      consoleUsersOnly: false,
      inputValidator: [routeParamsValidator, recordIdParamsValidator],
      outputValidator: crudResource.operations.view.outputValidator,
      idempotency: "none",
      audit: {
        actionName: actionIds.view
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.crudService.getRecord(input.recordId, {
          context,
          visibilityContext: context?.visibilityContext
        });
      }
    },
    {
      id: actionIds.create,
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      consoleUsersOnly: false,
      inputValidator: [routeParamsValidator, crudResource.operations.create.bodyValidator],
      outputValidator: crudResource.operations.create.outputValidator,
      idempotency: "optional",
      audit: {
        actionName: actionIds.create
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.crudService.createRecord(input, {
          context,
          visibilityContext: context?.visibilityContext
        });
      }
    },
    {
      id: actionIds.update,
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      consoleUsersOnly: false,
      inputValidator: [routeParamsValidator, recordIdParamsValidator, crudResource.operations.patch.bodyValidator],
      outputValidator: crudResource.operations.patch.outputValidator,
      idempotency: "optional",
      audit: {
        actionName: actionIds.update
      },
      observability: {},
      async execute(input, context, deps) {
        const { recordId, ...patch } = input;
        return deps.crudService.updateRecord(recordId, patch, {
          context,
          visibilityContext: context?.visibilityContext
        });
      }
    },
    {
      id: actionIds.delete,
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      consoleUsersOnly: false,
      inputValidator: [routeParamsValidator, recordIdParamsValidator],
      outputValidator: crudResource.operations.delete.outputValidator,
      idempotency: "optional",
      audit: {
        actionName: actionIds.delete
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.crudService.deleteRecord(input.recordId, {
          context,
          visibilityContext: context?.visibilityContext
        });
      }
    }
  ]);
}

export { createActions };
