import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importFreshModuleFromAbsolutePath } from "@jskit-ai/kernel/server/support";

const testSupportDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testSupportDirectory, "..");
const serverTemplateRoot = path.join(packageRoot, "templates", "src", "local-package", "server");

const CRUD_NAMESPACE = Object.freeze({
  snake: "customers",
  camel: "customers",
  singularCamel: "customer",
  pascal: "Customers"
});

function buildTemplateReplacements({
  surfaceRequiresWorkspace = true,
  requiresNamedPermissions = surfaceRequiresWorkspace === true,
  surfaceId = surfaceRequiresWorkspace ? "admin" : "home"
} = {}) {
  const routeWorkspaceSupportImports = surfaceRequiresWorkspace
    ? [
        'import { routeParamsValidator } from "@jskit-ai/users-core/server/validators/routeParamsValidator";',
        'import { buildWorkspaceInputFromRouteParams } from "@jskit-ai/users-core/server/support/workspaceRouteInput";'
      ].join("\n")
    : "";
  const actionWorkspaceValidatorImport = surfaceRequiresWorkspace
    ? 'import { workspaceSlugParamsValidator } from "@jskit-ai/users-core/server/validators/routeParamsValidator";'
    : "";
  const actionPermissionSupport = requiresNamedPermissions
    ? [
        "const actionPermissions = Object.freeze({",
        '  list: "crud.customers.list",',
        '  view: "crud.customers.view",',
        '  create: "crud.customers.create",',
        '  update: "crud.customers.update",',
        '  delete: "crud.customers.delete"',
        "});"
      ].join("\n")
    : [
        "const authenticatedPermission = Object.freeze({",
        '  require: "authenticated"',
        "});"
      ].join("\n");
  const listActionPermission = requiresNamedPermissions
    ? '{ require: "all", permissions: [actionPermissions.list] }'
    : "authenticatedPermission";
  const viewActionPermission = requiresNamedPermissions
    ? '{ require: "all", permissions: [actionPermissions.view] }'
    : "authenticatedPermission";
  const createActionPermission = requiresNamedPermissions
    ? '{ require: "all", permissions: [actionPermissions.create] }'
    : "authenticatedPermission";
  const updateActionPermission = requiresNamedPermissions
    ? '{ require: "all", permissions: [actionPermissions.update] }'
    : "authenticatedPermission";
  const deleteActionPermission = requiresNamedPermissions
    ? '{ require: "all", permissions: [actionPermissions.delete] }'
    : "authenticatedPermission";

  return Object.freeze([
    ["${option:namespace|snake}", CRUD_NAMESPACE.snake],
    ["${option:namespace|camel}", CRUD_NAMESPACE.camel],
    ["${option:namespace|singular|camel}", CRUD_NAMESPACE.singularCamel],
    ["${option:namespace|pascal}", CRUD_NAMESPACE.pascal],
    ["__JSKIT_CRUD_ID_COLUMN__", JSON.stringify("id")],
    ["__JSKIT_CRUD_SURFACE_ID__", JSON.stringify(surfaceId)],
    ["__JSKIT_CRUD_ACTION_PERMISSION_SUPPORT__", actionPermissionSupport],
    ["__JSKIT_CRUD_ACTION_WORKSPACE_VALIDATOR_IMPORT__", actionWorkspaceValidatorImport],
    ["__JSKIT_CRUD_LIST_ACTION_PERMISSION__", listActionPermission],
    ["__JSKIT_CRUD_LIST_ACTION_INPUT_VALIDATOR__", surfaceRequiresWorkspace
      ? "[workspaceSlugParamsValidator, listCursorPaginationQueryValidator, listSearchQueryValidator, listParentFilterQueryValidator, lookupIncludeQueryValidator]"
      : "[listCursorPaginationQueryValidator, listSearchQueryValidator, listParentFilterQueryValidator, lookupIncludeQueryValidator]"],
    ["__JSKIT_CRUD_VIEW_ACTION_PERMISSION__", viewActionPermission],
    ["__JSKIT_CRUD_VIEW_ACTION_INPUT_VALIDATOR__", surfaceRequiresWorkspace
      ? "[workspaceSlugParamsValidator, recordIdParamsValidator, lookupIncludeQueryValidator]"
      : "[recordIdParamsValidator, lookupIncludeQueryValidator]"],
    ["__JSKIT_CRUD_CREATE_ACTION_PERMISSION__", createActionPermission],
    ["__JSKIT_CRUD_CREATE_ACTION_INPUT_VALIDATOR__", surfaceRequiresWorkspace
      ? '[workspaceSlugParamsValidator, { payload: resource.operations.create.bodyValidator }]'
      : "{ payload: resource.operations.create.bodyValidator }"],
    ["__JSKIT_CRUD_UPDATE_ACTION_PERMISSION__", updateActionPermission],
    ["__JSKIT_CRUD_UPDATE_ACTION_INPUT_VALIDATOR__", surfaceRequiresWorkspace
      ? '[workspaceSlugParamsValidator, recordIdParamsValidator, { patch: resource.operations.patch.bodyValidator }]'
      : "[recordIdParamsValidator, { patch: resource.operations.patch.bodyValidator }]"],
    ["__JSKIT_CRUD_DELETE_ACTION_PERMISSION__", deleteActionPermission],
    ["__JSKIT_CRUD_DELETE_ACTION_INPUT_VALIDATOR__", surfaceRequiresWorkspace
      ? "[workspaceSlugParamsValidator, recordIdParamsValidator]"
      : "recordIdParamsValidator"],
    ["__JSKIT_CRUD_ROUTE_SURFACE_REQUIRES_WORKSPACE__", String(surfaceRequiresWorkspace === true)],
    ["__JSKIT_CRUD_ROUTE_WORKSPACE_SUPPORT_IMPORTS__", routeWorkspaceSupportImports],
    ["__JSKIT_CRUD_LIST_ROUTE_PARAMS_VALIDATOR_LINE__", surfaceRequiresWorkspace ? "      paramsValidator: routeParamsValidator," : ""],
    ["__JSKIT_CRUD_VIEW_ROUTE_PARAMS_VALIDATOR_LINE__", surfaceRequiresWorkspace ? "      paramsValidator: [routeParamsValidator, recordIdParamsValidator]," : "      paramsValidator: recordIdParamsValidator,"],
    ["__JSKIT_CRUD_CREATE_ROUTE_PARAMS_VALIDATOR_LINE__", surfaceRequiresWorkspace ? "      paramsValidator: routeParamsValidator," : ""],
    ["__JSKIT_CRUD_UPDATE_ROUTE_PARAMS_VALIDATOR_LINE__", surfaceRequiresWorkspace ? "      paramsValidator: [routeParamsValidator, recordIdParamsValidator]," : "      paramsValidator: recordIdParamsValidator,"],
    ["__JSKIT_CRUD_DELETE_ROUTE_PARAMS_VALIDATOR_LINE__", surfaceRequiresWorkspace ? "      paramsValidator: [routeParamsValidator, recordIdParamsValidator]," : "      paramsValidator: recordIdParamsValidator,"],
    ["__JSKIT_CRUD_LIST_ROUTE_INPUT_LINES__", surfaceRequiresWorkspace
      ? ["          ...buildWorkspaceInputFromRouteParams(request.input.params),", "          ...(request.input.query || {})"].join("\n")
      : "          ...(request.input.query || {})"],
    ["__JSKIT_CRUD_VIEW_ROUTE_INPUT_LINES__", surfaceRequiresWorkspace
      ? [
          "          ...buildWorkspaceInputFromRouteParams(request.input.params),",
          "          recordId: request.input.params.recordId,",
          "          ...(request.input.query || {})"
        ].join("\n")
      : [
          "          recordId: request.input.params.recordId,",
          "          ...(request.input.query || {})"
        ].join("\n")],
    ["__JSKIT_CRUD_CREATE_ROUTE_INPUT_LINES__", surfaceRequiresWorkspace
      ? [
          "          ...buildWorkspaceInputFromRouteParams(request.input.params),",
          "          payload: request.input.body"
        ].join("\n")
      : "          payload: request.input.body"],
    ["__JSKIT_CRUD_UPDATE_ROUTE_INPUT_LINES__", surfaceRequiresWorkspace
      ? [
          "          ...buildWorkspaceInputFromRouteParams(request.input.params),",
          "          recordId: request.input.params.recordId,",
          "          patch: request.input.body"
        ].join("\n")
      : [
          "          recordId: request.input.params.recordId,",
          "          patch: request.input.body"
        ].join("\n")],
    ["__JSKIT_CRUD_DELETE_ROUTE_INPUT_LINES__", surfaceRequiresWorkspace
      ? [
          "          ...buildWorkspaceInputFromRouteParams(request.input.params),",
          "          recordId: request.input.params.recordId"
        ].join("\n")
      : "          recordId: request.input.params.recordId"],
    [
      "__JSKIT_CRUD_LIST_CONFIG_LINES__",
      [
        "  // defaultLimit: 20,",
        "  // maxLimit: 100,",
        "  // searchColumns: [\"name\"],"
      ].join("\n")
    ]
  ]);
}

function applyTemplateReplacements(sourceText = "", options = {}) {
  let rendered = String(sourceText || "");
  for (const [needle, replacement] of buildTemplateReplacements(options)) {
    rendered = rendered.split(needle).join(replacement);
  }
  return rendered;
}

function buildResourceStubSource() {
  return `const recordOutputValidator = Object.freeze({
  schema: {
    properties: {
      id: {},
      name: {}
    }
  },
  normalize(payload = {}) {
    return payload;
  }
});

const createBodyValidator = Object.freeze({
  schema: {
    properties: {
      name: {},
      contactId: {}
    }
  },
  normalize(payload = {}) {
    return payload;
  }
});

const patchBodyValidator = Object.freeze({
  schema: {
    properties: {
      name: {},
      contactId: {}
    }
  },
  normalize: createBodyValidator.normalize
});

const resource = Object.freeze({
  resource: "customers",
  tableName: "customers",
  idColumn: "id",
  operations: {
    list: {
      outputValidator: Object.freeze({
        schema: {
          properties: {
            items: {},
            nextCursor: {}
          }
        },
        normalize(payload = {}) {
          return payload;
        }
      })
    },
    view: {
      outputValidator: recordOutputValidator
    },
    create: {
      bodyValidator: createBodyValidator,
      outputValidator: recordOutputValidator
    },
    patch: {
      bodyValidator: patchBodyValidator,
      outputValidator: recordOutputValidator
    },
    delete: {
      outputValidator: Object.freeze({
        schema: {
          properties: {
            id: {},
            deleted: {}
          }
        },
        normalize(payload = {}) {
          return payload;
        }
      })
    }
  },
  fieldMeta: [
    {
      key: "contactId",
      relation: {
        kind: "lookup",
        namespace: "contacts",
        valueKey: "id"
      }
    }
  ]
});

export { resource };
`;
}

async function renderServerTemplateFile(targetServerDirectory, fileName, options) {
  const templatePath = path.join(serverTemplateRoot, fileName);
  const templateSource = await readFile(templatePath, "utf8");
  const renderedSource = applyTemplateReplacements(templateSource, options);
  await writeFile(path.join(targetServerDirectory, fileName), renderedSource, "utf8");
}

async function createTemplateServerFixture(options = {}) {
  const fixtureRoot = await mkdtemp(path.join(packageRoot, ".tmp-crud-server-template-fixture-"));
  const srcRoot = path.join(fixtureRoot, "src");
  const serverRoot = path.join(srcRoot, "server");
  const sharedRoot = path.join(srcRoot, "shared");

  await mkdir(serverRoot, { recursive: true });
  await mkdir(sharedRoot, { recursive: true });
  await writeFile(
    path.join(fixtureRoot, "package.json"),
    JSON.stringify({ name: "crud-server-template-fixture", private: true, type: "module" }, null, 2),
    "utf8"
  );
  await writeFile(path.join(sharedRoot, "customerResource.js"), buildResourceStubSource(), "utf8");

  for (const fileName of ["actionIds.js", "actions.js", "listConfig.js", "registerRoutes.js", "repository.js", "service.js"]) {
    await renderServerTemplateFile(serverRoot, fileName, options);
  }

  async function importServerModule(fileName) {
    const absolutePath = path.join(serverRoot, fileName);
    return importFreshModuleFromAbsolutePath(absolutePath);
  }

  async function cleanup() {
    await rm(fixtureRoot, { recursive: true, force: true });
  }

  return Object.freeze({
    fixtureRoot,
    importServerModule,
    cleanup
  });
}

export { createTemplateServerFixture };
