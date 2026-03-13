import { requireAuthenticated } from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { inputValidators } from "./inputValidators.js";
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
      input: [inputValidators.workspaceParamsValidator, inputValidators.listQueryValidator],
      output: crudResource.operations.list.output,
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
      input: [inputValidators.workspaceParamsValidator, inputValidators.recordIdParamsValidator],
      output: crudResource.operations.view.output,
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
      input: [inputValidators.workspaceParamsValidator, crudResource.operations.create.body],
      output: crudResource.operations.create.output,
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
      input: [inputValidators.workspaceParamsValidator, inputValidators.recordIdParamsValidator, crudResource.operations.patch.body],
      output: crudResource.operations.patch.output,
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
      input: [inputValidators.workspaceParamsValidator, inputValidators.recordIdParamsValidator],
      output: crudResource.operations.delete.output,
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
