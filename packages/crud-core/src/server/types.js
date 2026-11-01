// The types of the capability a CRUD feature provides, for features that require it,
// of what its custom actions receive, and of the records repository a CRUD service uses.

/**
 * The resource definition a CRUD feature serves, as defineCrudResource returns it.
 * @typedef {object} CrudResourceDefinition
 */

/**
 * The JSON:API repository a CRUD feature provides as its capability's `repository`.
 * @typedef {ReturnType<typeof import("./jsonApiModule/repository.js").createCrudJsonApiRepository>} CrudRepository
 */

/**
 * The JSON:API service a CRUD feature provides as its capability's `service`.
 * @typedef {ReturnType<typeof import("./jsonApiModule/service.js").createCrudJsonApiService>} CrudService
 */

/**
 * The scope of a scoped CRUD resource: the route base its routes live under,
 * the validators of the scope's route params and action input, the input keys
 * the scope owns, and input(request), which reads them from a request.
 * Workspaces-core's WORKSPACE_CRUD_SCOPE is the workspace one.
 * @typedef {object} CrudScope
 * @property {string} [routeBase]
 * @property {object} [actionInputValidator]
 * @property {object} [routeParamsValidator]
 * @property {ReadonlyArray<string>} [inputKeys]
 * @property {(request: any) => Record<string, unknown>} [input]
 */

/**
 * What a `defineCrudJsonApiFeature` feature provides under the capability its
 * application names: the resource, its repository and its service, after any
 * decorateRepository and decorateService. The service keeps only the methods
 * of the feature's enabled operations.
 * @typedef {object} CrudResourceApi
 * @property {CrudResourceDefinition} resource
 * @property {CrudRepository} repository
 * @property {CrudService} service
 */

/**
 * What a custom action's `execute` receives from its CRUD feature: the input
 * its schema validated, the action context, the feature's resource, repository
 * and service, and each capability in the feature's `requires`, under its local
 * name. `Service` is the service decorateService returns, when it adds methods;
 * `Requires` holds the types of the required capabilities an action uses.
 * @template [Service=CrudService]
 * @template [Requires={}]
 * @typedef {{
 *   input: any,
 *   context: object,
 *   resource: CrudResourceDefinition,
 *   repository: CrudRepository,
 *   service: Service
 * } & Requires} CrudCustomActionInvocation
 */

/**
 * The records repository a CRUD service reads and writes through, as createCrudResourceRuntime builds it.
 * @typedef {ReturnType<typeof import("./resourceRuntime/index.js").createCrudResourceRuntime>} CrudRecordRepository
 */

/**
 * The resource, namespace and field access a CRUD service's methods share.
 * @typedef {ReturnType<typeof import("./serviceMethods.js").createCrudServiceRuntime>} CrudServiceRuntime
 */

export {};
