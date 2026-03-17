import {
  cursorPaginationQueryValidator,
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/validators";
import { workspaceSlugParamsValidator } from "@jskit-ai/users-core/server/validators/routeParamsValidator";
import { crudResource } from "../shared/crudResource.js";
import { actionIds } from "./actionIds.js";

function createActions() {
  return Object.freeze([
    {
      id: actionIds.list,
      version: 1,
      kind: "query",
      channels: ["api", "automation", "internal"],
      surfaces: ["admin"],
      consoleUsersOnly: false,
      permission: {
        require: "authenticated"
      },
      inputValidator: [workspaceSlugParamsValidator, cursorPaginationQueryValidator],
      outputValidator: crudResource.operations.list.outputValidator,
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
      surfaces: ["admin"],
      consoleUsersOnly: false,
      permission: {
        require: "authenticated"
      },
      inputValidator: [workspaceSlugParamsValidator, recordIdParamsValidator],
      outputValidator: crudResource.operations.view.outputValidator,
      idempotency: "none",
      audit: {
        actionName: actionIds.view
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.${option:namespace|camel}Service.getRecord(input.recordId, {
          context,
          visibilityContext: context?.visibilityContext
        });
      }
    },
    {
      id: actionIds.create,
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: ["admin"],
      consoleUsersOnly: false,
      permission: {
        require: "authenticated"
      },
      inputValidator: [
        workspaceSlugParamsValidator,
        {
          payload: crudResource.operations.create.bodyValidator
        }
      ],
      outputValidator: crudResource.operations.create.outputValidator,
      idempotency: "optional",
      audit: {
        actionName: actionIds.create
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.${option:namespace|camel}Service.createRecord(input.payload, {
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
      surfaces: ["admin"],
      consoleUsersOnly: false,
      permission: {
        require: "authenticated"
      },
      inputValidator: [
        workspaceSlugParamsValidator,
        recordIdParamsValidator,
        {
          patch: crudResource.operations.patch.bodyValidator
        }
      ],
      outputValidator: crudResource.operations.patch.outputValidator,
      idempotency: "optional",
      audit: {
        actionName: actionIds.update
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.${option:namespace|camel}Service.updateRecord(input.recordId, input.patch, {
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
      surfaces: ["admin"],
      consoleUsersOnly: false,
      permission: {
        require: "authenticated"
      },
      inputValidator: [workspaceSlugParamsValidator, recordIdParamsValidator],
      outputValidator: crudResource.operations.delete.outputValidator,
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
