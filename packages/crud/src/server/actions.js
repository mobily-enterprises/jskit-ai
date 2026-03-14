import { requireAuthenticated } from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import {
  cursorPaginationQueryValidator,
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/validators";
import { routeParamsValidator } from "@jskit-ai/users-core/server/validators/routeParamsValidator";
import { crudResource } from "../shared/crud/crudResource.js";
import { createActionIds } from "./actionIds.js";

function createActions({ actionIdPrefix } = {}) {
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
      permission: requireAuthenticated,
      idempotency: "none",
      audit: {
        actionName: actionIds.list
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.crudService.listRecords(input, {
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
      permission: requireAuthenticated,
      idempotency: "none",
      audit: {
        actionName: actionIds.view
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.crudService.getRecord(input.recordId, {
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
      permission: requireAuthenticated,
      idempotency: "optional",
      audit: {
        actionName: actionIds.create
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.crudService.createRecord(input, {
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
      permission: requireAuthenticated,
      idempotency: "optional",
      audit: {
        actionName: actionIds.update
      },
      observability: {},
      async execute(input, context, deps) {
        const { recordId, ...patch } = input;
        return deps.crudService.updateRecord(recordId, patch, {
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
      permission: requireAuthenticated,
      idempotency: "optional",
      audit: {
        actionName: actionIds.delete
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.crudService.deleteRecord(input.recordId, {
          visibilityContext: context?.visibilityContext
        });
      }
    }
  ]);
}

export { createActions };
