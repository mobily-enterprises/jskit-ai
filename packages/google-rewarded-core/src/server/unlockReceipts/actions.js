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
import { resource } from "../../shared/googleRewardedUnlockReceiptResource.js";
import { workspaceSlugParamsValidator } from "@jskit-ai/workspaces-core/server/validators/routeParamsValidator";

const listCursorPaginationQueryValidator = createCrudCursorPaginationQueryValidator({
  orderBy: resource.defaultSort
});
const listParentFilterQueryValidator = createCrudParentFilterQueryValidator(resource);
const actionPermissions = Object.freeze({
  list: "crud.google_rewarded_unlock_receipts.list",
  view: "crud.google_rewarded_unlock_receipts.view",
  create: "crud.google_rewarded_unlock_receipts.create",
  update: "crud.google_rewarded_unlock_receipts.update",
  delete: "crud.google_rewarded_unlock_receipts.delete"
});

function createActions({ surface } = {}) {
  return Object.freeze([
    {
      id: "crud.google_rewarded_unlock_receipts.list",
      version: 1,
      kind: "query",
      channels: ["api", "automation", "internal"],
      surfaces: [surface],
      permission: { require: "all", permissions: [actionPermissions.list] },
      input: composeSchemaDefinitions([
  workspaceSlugParamsValidator,
  listCursorPaginationQueryValidator,
  listSearchQueryValidator,
  listParentFilterQueryValidator,
  lookupIncludeQueryValidator,
]),
      output: null,
      idempotency: "none",
      audit: {
        actionName: "crud.google_rewarded_unlock_receipts.list"
      },
      observability: {},
      async execute(input, context, deps) {
        const { workspaceSlug, ...query } = input || {};
        return deps.googleRewardedUnlockReceiptsService.queryDocuments(query, {
          context
        });
      }
    },
    {
      id: "crud.google_rewarded_unlock_receipts.view",
      version: 1,
      kind: "query",
      channels: ["api", "automation", "internal"],
      surfaces: [surface],
      permission: { require: "all", permissions: [actionPermissions.view] },
      input: composeSchemaDefinitions([
  workspaceSlugParamsValidator,
  recordIdParamsValidator,
  lookupIncludeQueryValidator,
]),
      output: null,
      idempotency: "none",
      audit: {
        actionName: "crud.google_rewarded_unlock_receipts.view"
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.googleRewardedUnlockReceiptsService.getDocumentById(input.recordId, {
          context,
          include: input.include
        });
      }
    },
    {
      id: "crud.google_rewarded_unlock_receipts.create",
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: [surface],
      permission: { require: "all", permissions: [actionPermissions.create] },
      input: composeSchemaDefinitions([
  workspaceSlugParamsValidator,
  resource.operations.create.body,
], {
  mode: "create"
}),
      output: null,
      idempotency: "optional",
      audit: {
        actionName: "crud.google_rewarded_unlock_receipts.create"
      },
      observability: {},
      async execute(input, context, deps) {
        const { workspaceSlug, ...payload } = input || {};
        return deps.googleRewardedUnlockReceiptsService.createDocument(payload, {
          context
        });
      }
    },
    {
      id: "crud.google_rewarded_unlock_receipts.update",
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: [surface],
      permission: { require: "all", permissions: [actionPermissions.update] },
      input: composeSchemaDefinitions([
  workspaceSlugParamsValidator,
  recordIdParamsValidator,
  resource.operations.patch.body,
]),
      output: null,
      idempotency: "optional",
      audit: {
        actionName: "crud.google_rewarded_unlock_receipts.update"
      },
      observability: {},
      async execute(input, context, deps) {
        const { workspaceSlug, recordId, ...patch } = input || {};
        return deps.googleRewardedUnlockReceiptsService.patchDocumentById(recordId, patch, {
          context
        });
      }
    },
    {
      id: "crud.google_rewarded_unlock_receipts.delete",
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: [surface],
      permission: { require: "all", permissions: [actionPermissions.delete] },
      input: composeSchemaDefinitions([
  workspaceSlugParamsValidator,
  recordIdParamsValidator,
]),
      output: null,
      idempotency: "optional",
      audit: {
        actionName: "crud.google_rewarded_unlock_receipts.delete"
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.googleRewardedUnlockReceiptsService.deleteDocumentById(input.recordId, {
          context
        });
      }
    }
  ]);
}

export { createActions };
