import {
  cursorPaginationQueryValidator,
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/validators";
import { workspaceSlugParamsValidator } from "@jskit-ai/users-core/server/validators/routeParamsValidator";
import { crudResource } from "../shared/crud/crudResource.js";
import { createActionIds } from "./actionIds.js";

function requireActionSurface(surface = "") {
  const normalizedSurface = String(surface || "").trim().toLowerCase();
  if (!normalizedSurface) {
    throw new TypeError("createActions requires a non-empty surface.");
  }

  return normalizedSurface;
}

function createActions({ actionIdPrefix, surface = "" } = {}) {
  const actionIds = createActionIds(actionIdPrefix);
  const actionSurface = requireActionSurface(surface);

  return Object.freeze([
    {
      id: actionIds.list,
      version: 1,
      kind: "query",
      channels: ["api", "automation", "internal"],
      surfaces: [actionSurface],
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
      channels: ["api", "automation", "internal"],
      surfaces: [actionSurface],
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
      channels: ["api", "automation", "internal"],
      surfaces: [actionSurface],
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
        return deps.crudService.createRecord(input.payload, {
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
        return deps.crudService.updateRecord(input.recordId, input.patch, {
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
        return deps.crudService.deleteRecord(input.recordId, {
          context,
          visibilityContext: context?.visibilityContext
        });
      }
    }
  ]);
}

export { createActions };
