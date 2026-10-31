// The type of the capability a CRUD feature provides, for features that require it,
// and of what its custom actions receive.

/**
 * What a `defineCrudJsonApiFeature` feature provides under the capability its
 * application names: the resource, its repository and its service, after any
 * decorateRepository and decorateService. The service keeps only the methods
 * of the feature's enabled operations.
 * @typedef {object} CrudResourceApi
 * @property {object} resource
 * @property {ReturnType<typeof import("./jsonApiModule/repository.js").createCrudJsonApiRepository>} repository
 * @property {ReturnType<typeof import("./jsonApiModule/service.js").createCrudJsonApiService>} service
 */

/**
 * What a custom action's `execute` receives from its CRUD feature: the input
 * its schema validated, the action context, the feature's resource, repository
 * and service, and each capability in the feature's `requires`, under its local
 * name. `Service` is the service decorateService returns, when it adds methods;
 * `Requires` holds the types of the required capabilities an action uses.
 * @template [Service=CrudResourceApi["service"]]
 * @template [Requires={}]
 * @typedef {{
 *   input: any,
 *   context: object,
 *   resource: CrudResourceApi["resource"],
 *   repository: CrudResourceApi["repository"],
 *   service: Service
 * } & Requires} CrudCustomActionInvocation
 */

export {};
