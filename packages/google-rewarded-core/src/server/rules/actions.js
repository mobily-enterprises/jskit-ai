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
import { resource } from "../../shared/googleRewardedRuleResource.js";
import { workspaceSlugParamsValidator } from "@jskit-ai/workspaces-core/server/validators/routeParamsValidator";

const listCursorPaginationQueryValidator = createCrudCursorPaginationQueryValidator({
  orderBy: resource.defaultSort
});
const listParentFilterQueryValidator = createCrudParentFilterQueryValidator(resource);
const actionPermissions = Object.freeze({
  list: "crud.google_rewarded_rules.list",
  view: "crud.google_rewarded_rules.view",
  create: "crud.google_rewarded_rules.create",
  update: "crud.google_rewarded_rules.update",
  delete: "crud.google_rewarded_rules.delete"
});

function createActions({ surface } = {}) {
  return Object.freeze([
    {
      id: "crud.google_rewarded_rules.list",
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
        actionName: "crud.google_rewarded_rules.list"
      },
      observability: {},
      async execute(input, context, deps) {
        const { workspaceSlug, ...query } = input || {};
        return deps.googleRewardedRulesService.queryDocuments(query, {
          context
        });
      }
    },
    {
      id: "crud.google_rewarded_rules.view",
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
        actionName: "crud.google_rewarded_rules.view"
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.googleRewardedRulesService.getDocumentById(input.recordId, {
          context,
          include: input.include
        });
      }
    },
    {
      id: "crud.google_rewarded_rules.create",
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
        actionName: "crud.google_rewarded_rules.create"
      },
      observability: {},
      async execute(input, context, deps) {
        const { workspaceSlug, ...payload } = input || {};
        return deps.googleRewardedRulesService.createDocument(payload, {
          context
        });
      }
    },
    {
      id: "crud.google_rewarded_rules.update",
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
        actionName: "crud.google_rewarded_rules.update"
      },
      observability: {},
      async execute(input, context, deps) {
        const { workspaceSlug, recordId, ...patch } = input || {};
        return deps.googleRewardedRulesService.patchDocumentById(recordId, patch, {
          context
        });
      }
    },
    {
      id: "crud.google_rewarded_rules.delete",
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
        actionName: "crud.google_rewarded_rules.delete"
      },
      observability: {},
      async execute(input, context, deps) {
        return deps.googleRewardedRulesService.deleteDocumentById(input.recordId, {
          context
        });
      }
    }
  ]);
}

export { createActions };
