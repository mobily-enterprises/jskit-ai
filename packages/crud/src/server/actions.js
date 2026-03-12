import { requireAuthenticated } from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { inputPartsValidator } from "./inputPartsValidator.js";
import { crudResource } from "../shared/crud/crudResource.js";

function createActionIds(actionIdPrefix = "crud") {
  const prefix = String(actionIdPrefix || "").trim() || "crud";

  return Object.freeze({
    list: `${prefix}.list`,
    view: `${prefix}.view`,
    create: `${prefix}.create`,
    update: `${prefix}.update`,
    delete: `${prefix}.delete`
  });
}

function createActions({ actionIdPrefix = "crud" } = {}) {
  const actionIds = createActionIds(actionIdPrefix);

  return Object.freeze([
    {
      id: actionIds.list,
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      consoleUsersOnly: false,
      input: [inputPartsValidator.workspaceParams, inputPartsValidator.listQuery],
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
      input: inputPartsValidator.routeParams,
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
      input: [inputPartsValidator.workspaceParams, crudResource.operations.create.body],
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
      input: [inputPartsValidator.routeParams, crudResource.operations.patch.body],
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
      input: inputPartsValidator.routeParams,
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

export { createActionIds, createActions };
