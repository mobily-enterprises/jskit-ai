import { recordIdParamsValidator } from "@jskit-ai/kernel/shared/validators";
import {
  createCrudCursorPaginationQueryValidator,
  listSearchQueryValidator
} from "@jskit-ai/crud-core/server/listQueryValidators";
import { resource } from "../shared/userResource.js";
import { actionIds } from "./actionIds.js";
import { LIST_CONFIG } from "./listConfig.js";

const listCursorPaginationQueryValidator = createCrudCursorPaginationQueryValidator(LIST_CONFIG);
const authenticatedPermission = Object.freeze({
  require: "authenticated"
});

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
      permission: authenticatedPermission,
      inputValidator: [listCursorPaginationQueryValidator, listSearchQueryValidator],
      outputValidator: resource.operations.list.outputValidator,
      idempotency: "none",
      audit: {
        actionName: actionIds.list
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.usersService.listRecords(input, {
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
      permission: authenticatedPermission,
      inputValidator: recordIdParamsValidator,
      outputValidator: resource.operations.view.outputValidator,
      idempotency: "none",
      audit: {
        actionName: actionIds.view
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.usersService.getRecord(input.recordId, {
          context,
          visibilityContext: context?.visibilityContext
        });
      }
    }
  ]);
}

export { createActions };
