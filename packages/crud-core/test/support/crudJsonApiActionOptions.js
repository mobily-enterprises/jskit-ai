// The options defineCrudFeature resolves before it calls createCrudJsonApiActions and
// registerCrudJsonApiRoutes, for tests that call those directly with only the options they exercise.

const CRUD_OPERATIONS = Object.freeze(["list", "view", "create", "update", "delete"]);
// The list action caps a limit at the repository's pageLimits().request: json-rest-api's default, 100.
const DEFAULT_REPOSITORY = Object.freeze({ pageLimits: () => Object.freeze({ request: 100, server: 1000 }) });

/** @param {object} options The options a test sets; every other option takes the feature's default. */
function crudJsonApiActionOptions(options) {
  return {
    repository: DEFAULT_REPOSITORY,
    operations: CRUD_OPERATIONS,
    scopeInputValidator: null,
    scopeInputKeys: [],
    listFilterQueryValidator: null,
    operationLifecycle: {},
    operationInputs: {},
    actions: {},
    dependencies: {},
    realtimeAudience: "event_scope",
    servedOverHttp: true,
    ...options
  };
}

/** @param {object} options The options a test sets; every other option takes the feature's default. */
function crudJsonApiRouteOptions(options) {
  return {
    routeBase: "/",
    internal: false,
    operations: CRUD_OPERATIONS,
    actions: {},
    operationInputs: {},
    listFilterQueryValidator: null,
    routeParamsValidator: null,
    scopeInput: null,
    ...options
  };
}

export { crudJsonApiActionOptions, crudJsonApiRouteOptions };
