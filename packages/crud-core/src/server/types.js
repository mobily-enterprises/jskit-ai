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
 * What an `operationLifecycle` hook receives: the operation, the input its
 * schema validated, the action context, the feature's resource, repository
 * and service, and `trx`, the transaction a create, update or delete runs in
 * (null for list and view, and in afterCommit, which runs after the commit).
 * `after` and `afterCommit` also receive the operation's `result`; `execute`
 * receives `standard(nextInput)`, which runs the standard operation.
 * `Service` and `Repository` are what decorateService and decorateRepository
 * return, when they add methods a hook calls.
 * @template [Service=CrudService]
 * @template [Repository=CrudRepository]
 * @typedef {object} CrudLifecycleContext
 * @property {"list" | "view" | "create" | "update" | "delete"} operation
 * @property {any} input
 * @property {object} context
 * @property {CrudResourceDefinition} resource
 * @property {Repository} repository
 * @property {Service} service
 * @property {import("@jskit-ai/database-runtime/server/types").RuntimeKnexTransaction | null} trx
 * @property {any} [result]
 * @property {(nextInput?: object) => Promise<any>} [standard]
 */

/**
 * One standard operation's hooks: `before`, `execute` and `after` share a
 * mutation's transaction, `execute` replaces the standard operation, and
 * `afterCommit` (mutations only) runs once the transaction has committed.
 * @template [Service=CrudService]
 * @template [Repository=CrudRepository]
 * @typedef {object} CrudLifecycleHooks
 * @property {(hook: CrudLifecycleContext<Service, Repository>) => unknown} [before]
 * @property {(hook: CrudLifecycleContext<Service, Repository>) => unknown} [execute]
 * @property {(hook: CrudLifecycleContext<Service, Repository>) => unknown} [after]
 * @property {(hook: CrudLifecycleContext<Service, Repository>) => unknown} [afterCommit]
 */

/**
 * A CRUD feature's `operationLifecycle`: the hooks of each standard operation
 * that has any. Type a lifecycle declared apart from its feature with it:
 * `@type {CrudOperationLifecycle<DrumsService, DrumsRepository>}`.
 * @template [Service=CrudService]
 * @template [Repository=CrudRepository]
 * @typedef {{ list?: CrudLifecycleHooks<Service, Repository>, view?: CrudLifecycleHooks<Service, Repository>, create?: CrudLifecycleHooks<Service, Repository>, update?: CrudLifecycleHooks<Service, Repository>, delete?: CrudLifecycleHooks<Service, Repository> }} CrudOperationLifecycle
 */

/**
 * The records repository a CRUD service reads and writes through, as createCrudResourceRuntime builds it.
 * @typedef {ReturnType<typeof import("./resourceRuntime/index.js").createCrudResourceRuntime>} CrudRecordRepository
 */

/**
 * What a records repository resolves once from its resource and options, and each of its calls reads.
 * @typedef {ReturnType<typeof import("./resourceRuntime/compiledRuntime.js").buildCompiledCrudRepositoryRuntime>} CompiledCrudRepositoryRuntime
 */

/**
 * The resource, namespace and field access a CRUD service's methods share.
 * @typedef {ReturnType<typeof import("./serviceMethods.js").createCrudServiceRuntime>} CrudServiceRuntime
 */

export {};
