import {
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/validators";
import {
  createCrudCursorPaginationQueryValidator,
  listSearchQueryValidator,
  lookupIncludeQueryValidator,
  createCrudParentFilterQueryValidator
} from "@jskit-ai/crud-core/server/listQueryValidators";
import { workspaceSlugParamsValidator } from "@jskit-ai/users-core/server/validators/routeParamsValidator";
import { resource } from "../shared/${option:namespace|singular|camel}Resource.js";
import { actionIds } from "./actionIds.js";
import { LIST_CONFIG } from "./listConfig.js";

const listCursorPaginationQueryValidator = createCrudCursorPaginationQueryValidator(LIST_CONFIG);
const listParentFilterQueryValidator = createCrudParentFilterQueryValidator(resource);

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
      permission: {
        require: "authenticated"
      },
      inputValidator: [
        workspaceSlugParamsValidator,
        listCursorPaginationQueryValidator,
        listSearchQueryValidator,
        listParentFilterQueryValidator,
        lookupIncludeQueryValidator
      ],
      outputValidator: resource.operations.list.outputValidator,
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
      permission: {
        require: "authenticated"
      },
      inputValidator: [workspaceSlugParamsValidator, recordIdParamsValidator, lookupIncludeQueryValidator],
      outputValidator: resource.operations.view.outputValidator,
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
      permission: {
        require: "authenticated"
      },
      inputValidator: [
        workspaceSlugParamsValidator,
        {
          payload: resource.operations.create.bodyValidator
        }
      ],
      outputValidator: resource.operations.create.outputValidator,
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
      surfaces: [actionSurface],
      permission: {
        require: "authenticated"
      },
      inputValidator: [
        workspaceSlugParamsValidator,
        recordIdParamsValidator,
        {
          patch: resource.operations.patch.bodyValidator
        }
      ],
      outputValidator: resource.operations.patch.outputValidator,
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
      surfaces: [actionSurface],
      permission: {
        require: "authenticated"
      },
      inputValidator: [workspaceSlugParamsValidator, recordIdParamsValidator],
      outputValidator: resource.operations.delete.outputValidator,
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
