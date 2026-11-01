// The options defineCrudJsonApiFeature resolves before it calls createCrudJsonApiActions and
// registerCrudJsonApiRoutes, for tests that call those directly with only the options they exercise.

const CRUD_OPERATIONS = Object.freeze(["list", "view", "create", "update", "delete"]);

/** @param {object} options The options a test sets; every other option takes the feature's default. */
function crudJsonApiActionOptions(options) {
  return {
    operations: CRUD_OPERATIONS,
    scopeInputValidator: null,
    scopeInputKeys: [],
    listFilterQueryValidator: null,
    operationLifecycle: {},
    operationInputs: {},
    actions: {},
    dependencies: {},
    realtimeAudience: "event_scope",
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
