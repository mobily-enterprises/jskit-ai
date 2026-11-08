import { defineFeature } from "@jskit-ai/kernel/server/features";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { isWorkspaceRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { isTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { withoutHiddenFields } from "@jskit-ai/resource-runtime/server";
import { isCrudContract } from "@jskit-ai/resource-crud-core/shared/crudContract";
import {
  assertCrudOperationName,
  createCrudJsonApiActionDefinitions,
  createCrudJsonApiActions,
  normalizeCrudOperationLifecycle
} from "./jsonApiModule/actions.js";
import { createCrudJsonApiRoutes, registerCrudRoutes } from "./jsonApiModule/routes.js";
import { createCrudService } from "./jsonApiModule/service.js";
import {
  LEGACY_REPOSITORY_METHODS,
  LEGACY_SERVICE_METHODS,
  rejectLegacyMethods,
  withRemovedProperties
} from "./removedApi.js";

const RESERVED_REQUIREMENT_NAMES = Object.freeze([
  "context",
  "crud",
  "crudContracts",
  "http",
  "input",
  "options",
  "ownerRepository",
  "repository",
  "resource",
  "resources",
  "result",
  "service",
  "standard",
  "systemContext"
]);
const CRUD_SERVICE_METHOD_BY_OPERATION = Object.freeze({
  list: "list",
  view: "view",
  create: "create",
  update: "patch",
  delete: "delete"
});
const CRUD_SERVICE_METHODS = new Set(Object.values(CRUD_SERVICE_METHOD_BY_OPERATION));
const CRUD_ACTION_OPERATIONS = Object.freeze(Object.keys(CRUD_SERVICE_METHOD_BY_OPERATION));
// The options defineCrudFeature takes.
const FEATURE_OPTIONS = new Set([
  "crud",
  "id",
  "capability",
  "surface",
  "owns",
  "ownerRepository",
  "visibility",
  "systemScope",
  "relativePath",
  "internal",
  "routes",
  "listFilterQueryValidator",
  "permissions",
  "scope",
  "requires",
  "decorateRepository",
  "decorateService",
  "operationLifecycle",
  "operationInputs",
  "actions",
  "operations",
  "realtimeAudience"
]);
// Options the earlier CRUD feature took, and where each now goes.
const REPLACED_FEATURE_OPTIONS = Object.freeze({
  resource: "crud, the CRUD contract",
  ownershipFilter: "visibility",
  searchSchema: "an owns entry: owns: [{ resource, searchSchema }]",
  rowPolicy: "an owns entry: owns: [{ resource, rowPolicy }]",
  queryFields: "an owns entry: owns: [{ resource, queryFields }]",
  hooks: "an owns entry: owns: [{ resource, hooks }]"
});
// What decorateRepository, decorateService and the feature's capability no longer carry.
const RESOURCE_RENAMED = "it is now crud, the CRUD contract.";
const REMOVED_REPOSITORY_DEPENDENCIES = Object.freeze({
  resource: RESOURCE_RENAMED,
  database: "read and write through repository and resources (each owned table's handle), and open a transaction with repository.withTransaction(options, work).",
  http: "defineCrudFeature registers the routes; name any other capability the repository needs in requires.",
  jsonRestApi: "each owned table's handle is in resources, by its resource name."
});
const REMOVED_SERVICE_DEPENDENCIES = Object.freeze({ resource: RESOURCE_RENAMED });
const REMOVED_RESOURCE_API = Object.freeze({ resource: RESOURCE_RENAMED });

/**
 * What `build` answers, built on first use and then kept: the contracts a feature builds from its definition alone,
 * which every composition and boot reuses. A build that throws keeps nothing, so each composition that reaches it
 * fails as the first did.
 * @template T
 * @param {() => T} build
 * @returns {() => T}
 */
function builtOnce(build) {
  let built;
  return () => (built ??= build());
}

/**
 * Refuses an option defineCrudFeature does not take, naming where an earlier
 * option now goes, so a setting is never silently ignored.
 * @param {Record<string, unknown>} options
 */
function assertKnownOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("defineCrudFeature takes an options object.");
  }
  for (const name of Object.keys(options)) {
    if (FEATURE_OPTIONS.has(name)) {
      continue;
    }
    if (Object.hasOwn(REPLACED_FEATURE_OPTIONS, name)) {
      throw new TypeError(`defineCrudFeature no longer takes ${name}: use ${REPLACED_FEATURE_OPTIONS[name]}.`);
    }
    throw new TypeError(`defineCrudFeature does not take ${name}. Its options are ${[...FEATURE_OPTIONS].join(", ")}.`);
  }
}

/**
 * Refuses a permission for anything but an action the feature defines: one of
 * its operations (list, view, create, update, delete) or a custom action.
 * @param {object | null} permissions
 * @param {object} actions
 */
function assertPermissionNames(permissions, actions) {
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
    return;
  }
  // An action's permission is read under its lower-case name.
  const actionNames = new Set([...CRUD_ACTION_OPERATIONS, ...Object.keys(actions)].map((name) => normalizeText(name).toLowerCase()));
  for (const name of Object.keys(permissions)) {
    const actionName = normalizeText(name).toLowerCase();
    if (!actionNames.has(actionName)) {
      const hint = actionName === "patch" ? ' (a patch is the "update" action)' : "";
      throw new TypeError(
        `defineCrudFeature permissions.${name} names no action of the feature${hint}. ` +
        `Its actions are ${[...actionNames].join(", ")}.`
      );
    }
    if (actionName !== name) {
      throw new TypeError(`defineCrudFeature reads the permission of action ${name} as permissions.${actionName}; name it so.`);
    }
  }
}

/**
 * Refuses a service that lacks, as its own property, a method an enabled
 * operation's route and action call, so the feature fails at boot rather than
 * on a request.
 * @param {object} service
 * @param {readonly string[]} operations
 */
function assertServiceOperations(service, operations) {
  for (const operation of operations) {
    const method = CRUD_SERVICE_METHOD_BY_OPERATION[operation];
    // readable-check: allow method-probe - input validation: decorateService returns the application's own service
    if (typeof service?.[method] !== "function") {
      throw new TypeError(
        `defineCrudFeature decorateService must return a service with its own ${method}(), which the ${operation} operation calls; ` +
        "spread the service it is given ({ ...service, ... }) to keep the standard one."
      );
    }
  }
}

function normalizeAccess(crud = {}) {
  const access = normalizeText(crud.apiAccess).toLowerCase() || "authenticated";
  if (access !== "authenticated" && access !== "public") {
    throw new TypeError('defineCrudFeature crud apiAccess must be "authenticated" or "public".');
  }
  return access;
}

function normalizeScope(scope = {}) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    throw new TypeError("defineCrudFeature scope must be an object.");
  }
  return Object.freeze({
    routeBase: normalizeText(scope.routeBase) || "/",
    actionInputValidator: scope.actionInputValidator || null,
    routeParamsValidator: scope.routeParamsValidator || null,
    inputKeys: Object.freeze([...new Set(
      (Array.isArray(scope.inputKeys) ? scope.inputKeys : [])
        .map((entry) => normalizeText(entry))
        .filter(Boolean)
    )]),
    // readable-check: allow method-probe - input validation: the scope an application passes may define input()
    input: typeof scope.input === "function" ? scope.input : null
  });
}

// The route visibility of a table's ownership: a workspace_or_shared table's routes are a workspace's.
function routeOwnership(ownership) {
  return ownership === "workspace_or_shared" ? "workspace" : ownership;
}

/**
 * The feature's owns: its CRUD contract's table resource first, unless an
 * entry gives that resource its server-only extras, then the other tables.
 * A feature serving another owner's table owns only the other tables, if any.
 * @param {import("./types.js").CrudContract} crud
 * @param {ReadonlyArray<object>} owns
 * @param {string} ownerRepository
 */
function crudOwns(crud, owns, ownerRepository) {
  if (!Array.isArray(owns)) {
    throw new TypeError("defineCrudFeature owns must be an array of table resources or { resource, ...extras } entries.");
  }
  const ownsCrudResource = owns.some((entry) => (isTableResource(entry) ? entry : entry?.resource) === crud.resource);
  if (ownerRepository) {
    if (ownsCrudResource) {
      throw new TypeError(`defineCrudFeature serves "${crud.resource.name}" through ${ownerRepository}, so it cannot own it too.`);
    }
    return owns.length > 0 ? Object.freeze([...owns]) : undefined;
  }
  return Object.freeze(ownsCrudResource ? [...owns] : [crud.resource, ...owns]);
}

function assertWorkspaceScope(scope, ownershipFilter) {
  if (!isWorkspaceRouteVisibility(ownershipFilter)) {
    return;
  }
  const missing = [];
  if (scope.routeBase === "/") missing.push("routeBase");
  if (!scope.actionInputValidator) missing.push("actionInputValidator");
  if (!scope.routeParamsValidator) missing.push("routeParamsValidator");
  if (scope.inputKeys.length < 1) missing.push("inputKeys");
  if (!scope.input) missing.push("input");
  if (missing.length > 0) {
    throw new TypeError(
      `Workspace CRUD feature requires explicit scope ${missing.join(", ")}.`
    );
  }
}

function normalizeFeatureRequirements(requires = {}) {
  if (!requires || typeof requires !== "object" || Array.isArray(requires)) {
    throw new TypeError("defineCrudFeature requires must be an object.");
  }
  for (const name of RESERVED_REQUIREMENT_NAMES) {
    if (Object.hasOwn(requires, name)) {
      throw new TypeError(`defineCrudFeature requires reserves the local name ${name}.`);
    }
  }
  return Object.freeze({ ...requires });
}

function operationsFromResource(resource) {
  const operationMap = Object.freeze({
    list: "list",
    view: "view",
    create: "create",
    patch: "update",
    delete: "delete"
  });
  return Object.keys(resource?.operations || {})
    .map((operation) => operationMap[operation])
    .filter(Boolean);
}

function normalizeOperations(operations, resource) {
  const source = operations === undefined ? operationsFromResource(resource) : operations;
  if (!Array.isArray(source) || source.length < 1) {
    throw new TypeError("defineCrudFeature operations must be a non-empty array.");
  }
  return Object.freeze([...new Set(source.map((operation) => assertCrudOperationName(operation)))]);
}

/**
 * @param {string} actionName
 * @param {{ access: string, workspaceScoped: boolean, permissions: { namespace: string } & Record<string, unknown> }} policy
 */
function resolveActionPermission(actionName, { access, workspaceScoped, permissions }) {
  const normalizedActionName = normalizeText(actionName).toLowerCase();
  if (!normalizedActionName) {
    throw new TypeError("CRUD action name is required.");
  }
  const explicitPermission = permissions[normalizedActionName];
  if (explicitPermission && typeof explicitPermission === "object") {
    return explicitPermission;
  }
  if (typeof explicitPermission === "string" && explicitPermission.trim()) {
    return Object.freeze({
      require: "all",
      permissions: [explicitPermission.trim()]
    });
  }
  if (access === "public") {
    return Object.freeze({ require: "none" });
  }
  if (workspaceScoped) {
    return Object.freeze({
      require: "all",
      permissions: [`crud.${permissions.namespace}.${normalizedActionName}`]
    });
  }
  return Object.freeze({ require: "authenticated" });
}

function projectEnabledServiceOperations(service, operations) {
  const enabledMethods = new Set(operations.map((operation) => CRUD_SERVICE_METHOD_BY_OPERATION[operation]));
  return Object.freeze(Object.fromEntries(
    Object.entries(service).filter(([name]) => !CRUD_SERVICE_METHODS.has(name) || enabledMethods.has(name))
  ));
}

/**
 * A feature serving a CRUD contract over HTTP and the action catalogue. It owns
 * the contract's table resource (and the tables in `owns`): its repository is
 * that table's handle, which `decorateRepository` may wrap, and its CRUD service
 * (list, view, create, patch, delete) is the HTTP edge, answering JSON:API
 * documents. The capability's repository refuses a read whose `fields` names a
 * hidden field of the table unless it runs in a system context: the methods
 * decorateRepository adds read them with the handle itself.
 * @param {object} feature
 * @param {import("./types.js").CrudContract} feature.crud The CRUD contract the feature serves, on its table resource.
 * @param {string} feature.surface The surface whose routes serve it.
 * @param {ReadonlyArray<object>} [feature.owns] More tables the feature owns, and `{ resource, rowPolicy, hooks, searchSchema, ... }`
 *   entries giving a table, the CRUD's own among them, its server-only extras.
 * @param {string} [feature.ownerRepository] The capability of the repository another feature, the table's one owner,
 *   provides for it, such as users-core's `users.profiles`: the feature then serves its CRUD surface through that
 *   repository and does not own the table.
 * @param {string} [feature.systemScope] Why the feature works across every workspace and user; decorateRepository then receives systemContext(reason).
 * @param {string} [feature.visibility] The routes' visibility, when it differs from the table's ownership: a
 *   workspace's admin surface serving a table every workspace shares (such as users) names "workspace", so its
 *   routes resolve the caller's workspace and their actions check its permissions. The rows a call reaches still
 *   follow the table's ownership.
 * @param {string} [feature.id] Defaults to `crud.<namespace>`.
 * @param {string} [feature.capability] Defaults to the feature id.
 * @param {string} [feature.relativePath] Defaults to the namespace, with dashes.
 * @param {boolean} [feature.internal] True keeps the routes off the HTTP server.
 * @param {boolean} [feature.routes] False registers no HTTP routes. Either way, an action no permission
 *   guards is then left off the automation channel, so the assistant cannot run it.
 * @param {object | null} [feature.listFilterQueryValidator]
 * @param {object | null} [feature.permissions]
 * @param {import("./types.js").CrudScope} [feature.scope] The route base, validators, input keys and input() of a scoped resource.
 * @param {Record<string, string>} [feature.requires] More capabilities the feature requires, by name.
 * @param {((dependencies: { repository: import("./types.js").CrudRepository, resources: Record<string, import("./types.js").CrudRepository>, crud: import("./types.js").CrudContract } & Record<string, any>) => import("./types.js").CrudRepository | Promise<import("./types.js").CrudRepository>) | null} [feature.decorateRepository]
 *   Receives the CRUD table's handle (or the owner's repository) as repository, every owned table's handle as
 *   resources, the CRUD contract, systemContext with systemScope, and the feature's requires.
 * @param {((dependencies: { service: import("./types.js").CrudService, repository: import("./types.js").CrudRepository, crud: import("./types.js").CrudContract } & Record<string, any>) => import("./types.js").CrudService | Promise<import("./types.js").CrudService>) | null} [feature.decorateService]
 *   Receives the CRUD service, the (decorated) repository, the CRUD contract and the feature's requires.
 * @param {import("./types.js").CrudOperationLifecycle} [feature.operationLifecycle]
 * @param {object} [feature.operationInputs]
 * @param {object} [feature.actions] Custom actions, by name.
 * @param {string[]} [feature.operations] Defaults to every operation the CRUD contract offers.
 * @param {string} [feature.realtimeAudience] Defaults to "event_scope".
 */
function defineCrudFeature(feature) {
  assertKnownOptions(feature);
  const {
    crud,
    id = "",
    capability = "",
    surface,
    owns = [],
    ownerRepository = "",
    visibility = "",
    systemScope = undefined,
    relativePath = "",
    internal = false,
    routes = true,
    listFilterQueryValidator = null,
    permissions = null,
    scope = {},
    requires = {},
    decorateRepository = null,
    decorateService = null,
    operationLifecycle = {},
    operationInputs = {},
    actions = {},
    operations = undefined,
    realtimeAudience = "event_scope"
  } = feature;
  if (!isCrudContract(crud)) {
    throw new TypeError("defineCrudFeature requires crud, a CRUD contract from defineCrudContract.");
  }
  const tableResource = crud.resource;
  if (tableResource.ownership === "system") {
    throw new TypeError(
      `defineCrudFeature serves requests, and only a system context reaches "${tableResource.name}" (ownership "system"): ` +
      "serve what a request may see through the owner's own methods instead."
    );
  }
  const namespace = crud.namespace;
  const featureId = normalizeText(id) || `crud.${namespace}`;
  const featureCapability = normalizeText(capability) || featureId;
  const normalizedSurface = normalizeText(surface).toLowerCase();
  if (!normalizedSurface) {
    throw new TypeError("defineCrudFeature requires surface.");
  }
  const ownershipFilter = normalizeText(visibility).toLowerCase() || routeOwnership(tableResource.ownership);
  const normalizedRelativePath = normalizeText(relativePath) || `/${namespace.replace(/_/gu, "-")}`;
  const access = normalizeAccess(crud);
  if (access === "public" && ownershipFilter !== "public") {
    throw new TypeError('A public CRUD feature serves a table resource whose ownership (or visibility) is "public".');
  }
  const normalizedScope = normalizeScope(scope);
  const featureRequirements = normalizeFeatureRequirements(requires);
  if (typeof ownerRepository !== "string") {
    throw new TypeError("defineCrudFeature ownerRepository must be the capability of the table owner's repository.");
  }
  const featureOwns = crudOwns(crud, owns, ownerRepository.trim());
  const enabledOperations = normalizeOperations(operations, crud);
  if (typeof routes !== "boolean") {
    throw new TypeError("defineCrudFeature routes must be a boolean.");
  }
  if (decorateRepository != null && typeof decorateRepository !== "function") {
    throw new TypeError("defineCrudFeature decorateRepository must be a function.");
  }
  if (decorateService != null && typeof decorateService !== "function") {
    throw new TypeError("defineCrudFeature decorateService must be a function.");
  }
  const normalizedOperationLifecycle = normalizeCrudOperationLifecycle(operationLifecycle);
  if (!operationInputs || typeof operationInputs !== "object" || Array.isArray(operationInputs)) {
    throw new TypeError("defineCrudFeature operationInputs must be an object.");
  }
  if (!actions || typeof actions !== "object" || Array.isArray(actions)) {
    throw new TypeError("defineCrudFeature actions must be an object.");
  }
  assertPermissionNames(permissions, actions);
  assertWorkspaceScope(normalizedScope, ownershipFilter);
  const workspaceScoped = isWorkspaceRouteVisibility(ownershipFilter);
  const permissionOptions = permissions && typeof permissions === "object" && !Array.isArray(permissions)
    ? { ...permissions, namespace }
    : { namespace };
  const servedOverHttp = routes && !internal;
  // The routes and the actions' inputs, permissions and assistant extensions depend on the definition alone (the
  // CRUD contract, the operations, the scope and the options above), never on what a composition provides.
  const crudRoutes = builtOnce(() => createCrudJsonApiRoutes({
    namespace,
    resource: crud,
    routeBase: normalizedScope.routeBase,
    relativePath: normalizedRelativePath,
    surface: normalizedSurface,
    ownershipFilter,
    access,
    internal,
    operations: enabledOperations,
    actions,
    listFilterQueryValidator,
    operationInputs,
    routeParamsValidator: normalizedScope.routeParamsValidator,
    scopeInput: normalizedScope.input
  }));
  const actionDefinitions = builtOnce(() => createCrudJsonApiActionDefinitions({
    namespace,
    resource: crud,
    surface: normalizedSurface,
    operations: enabledOperations,
    listFilterQueryValidator,
    operationInputs,
    actions,
    permissionForOperation: (operation) => resolveActionPermission(operation, {
      access,
      workspaceScoped,
      permissions: permissionOptions
    }),
    scopeInputValidator: normalizedScope.actionInputValidator,
    servedOverHttp
  }));

  return defineFeature({
    id: featureId,
    domain: "crud",
    ...(featureOwns ? { owns: featureOwns } : {}),
    ...(systemScope === undefined ? {} : { systemScope }),
    requires: {
      http: "runtime.http",
      crudContracts: "crud.contracts",
      ...(ownerRepository.trim() ? { ownerRepository: ownerRepository.trim() } : {}),
      ...featureRequirements
    },
    provides: {
      resourceApi: featureCapability
    },
    async setup({ http, crudContracts, resources = {}, systemContext, ownerRepository: servedRepository, ...featureDependencies }) {
      crudContracts.register(crud);
      const handle = servedRepository || resources[tableResource.name];
      const repository = decorateRepository
        ? rejectLegacyMethods(await decorateRepository(Object.freeze(withRemovedProperties({
            repository: handle,
            resources,
            crud,
            ...(systemContext ? { systemContext } : {}),
            ...featureDependencies
          }, REMOVED_REPOSITORY_DEPENDENCIES, "decorateRepository's dependencies"))), LEGACY_REPOSITORY_METHODS, "The repository decorateRepository returned")
        : handle;
      const defaultService = createCrudService({ repository, crud });
      const decoratedService = decorateService
        ? rejectLegacyMethods(await decorateService(Object.freeze(withRemovedProperties({
            service: defaultService,
            repository,
            crud,
            ...featureDependencies
          }, REMOVED_SERVICE_DEPENDENCIES, "decorateService's dependencies"))), LEGACY_SERVICE_METHODS, "The service decorateService returned")
        : defaultService;
      const service = projectEnabledServiceOperations(decoratedService, enabledOperations);
      assertServiceOperations(service, enabledOperations);
      if (routes) {
        registerCrudRoutes(http.router, crudRoutes());
      }
      // The handle decorateRepository receives answers hidden fields to the owner's own methods; other features,
      // and this feature's actions, read them only in a system context, through any method the repository holds.
      const exposed = withoutHiddenFields(repository, [
        tableResource,
        ...(featureOwns ?? []).map((entry) => (isTableResource(entry) ? entry : entry.resource))
      ]);
      return {
        resourceApi: Object.freeze(withRemovedProperties({ repository: exposed, crud, service }, REMOVED_RESOURCE_API, "A CRUD feature's capability"))
      };
    },
    actions({ resourceApi, ...required }) {
      const actionDependencies = Object.freeze(Object.fromEntries(
        Object.keys(featureRequirements).map((name) => [name, required[name]])
      ));
      return createCrudJsonApiActions({
        namespace,
        resource: crud,
        repository: resourceApi.repository,
        service: resourceApi.service,
        operationLifecycle: normalizedOperationLifecycle,
        dependencies: actionDependencies,
        scopeInputKeys: normalizedScope.inputKeys,
        realtimeAudience,
        definitions: actionDefinitions()
      });
    }
  });
}

export { defineCrudFeature };
