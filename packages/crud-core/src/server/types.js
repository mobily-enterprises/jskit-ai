// The types of the capability a CRUD feature provides, for features that require it,
// and of what its custom actions and lifecycle hooks receive.

/**
 * One table's description, as defineTableResource returns it.
 * @typedef {object} TableResource
 */

/**
 * The CRUD surface a CRUD feature serves, as defineCrudContract returns it; its
 * table resource is its `resource`.
 * @typedef {object} CrudContract
 */

/**
 * The repository a CRUD feature provides as its capability's `repository`: its
 * CRUD table's handle, as decorateRepository returns it.
 * @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} CrudRepository
 */

/**
 * The CRUD service a CRUD feature provides as its capability's `service`: list,
 * view, create, patch and delete, answering JSON:API documents.
 * @typedef {ReturnType<typeof import("./jsonApiModule/service.js").createCrudService>} CrudService
 */

/**
 * A tagged JSON:API result, as returnJsonApiDocument and returnJsonApiData
 * (`@jskit-ai/http-runtime/shared`) build it. A CRUD service's document methods
 * and a feature's standard list, view, create and update operations return
 * document results; an execute hook or a decorated service may return a data
 * result (one record) instead.
 * @typedef {ReturnType<typeof import("@jskit-ai/http-runtime/shared").returnJsonApiDocument>} CrudJsonApiResult
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
 * What a `defineCrudFeature` feature provides under the capability its
 * application names: the CRUD contract, its repository and its service, after
 * any decorateRepository and decorateService. The service keeps only the
 * methods of the feature's enabled operations.
 * @typedef {object} CrudResourceApi
 * @property {CrudContract} crud
 * @property {CrudRepository} repository
 * @property {CrudService} service
 */

/**
 * What a custom action's `execute` receives from its CRUD feature: the input
 * its schema validated, the action context, the feature's resource, repository
 * and service, and each capability in the feature's `requires`, under its local
 * name. `Service` is the service decorateService returns, when it adds methods;
 * `Requires` holds the types of the required capabilities an action uses;
 * `Repository` is the repository decorateRepository returns, when it adds methods.
 * @template [Service=CrudService]
 * @template [Requires={}]
 * @template [Repository=CrudRepository]
 * @typedef {{
 *   input: any,
 *   context: object,
 *   resource: CrudContract,
 *   repository: Repository,
 *   service: Service
 * } & Requires} CrudCustomActionInvocation
 */

/**
 * What an `operationLifecycle` hook receives: the operation, the input its
 * schema validated, the action context, the feature's resource, repository
 * and service, and `options`, the call options to pass to the repository:
 * `{ context }`, and inside a create, update or delete the transaction they
 * share (afterCommit, which runs after the commit, gets `{ context }`).
 * `after` and `afterCommit` also receive the operation's `result` (the JSON:API
 * document result; null for delete); `execute` receives `standard(nextInput)`,
 * which runs the standard operation and returns its result.
 * `Service` and `Repository` are what decorateService and decorateRepository
 * return, when they add methods a hook calls.
 * @template [Service=CrudService]
 * @template [Repository=CrudRepository]
 * @typedef {object} CrudLifecycleContext
 * @property {"list" | "view" | "create" | "update" | "delete"} operation
 * @property {any} input
 * @property {object} context
 * @property {CrudContract} resource
 * @property {Repository} repository
 * @property {Service} service
 * @property {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} options
 * @property {CrudJsonApiResult | null} [result]
 * @property {(nextInput?: object) => Promise<CrudJsonApiResult | null>} [standard]
 */

/**
 * One standard operation's hooks: `before`, `execute` and `after` share a
 * mutation's transaction, `execute` replaces the standard operation, and
 * `afterCommit` (mutations only) runs once the transaction has committed.
 * `execute` returns what `standard()` returns: the operation's tagged JSON:API
 * result (null for delete). A create's must carry the created record with its
 * id, as a document result (what `standard()` returns) or a data result
 * (`returnJsonApiData(record)`), since its created and record-changed events
 * read the record's id from it; a create that returns anything else, such as
 * an untagged document or record, fails inside its transaction.
 * @template [Service=CrudService]
 * @template [Repository=CrudRepository]
 * @typedef {object} CrudLifecycleHooks
 * @property {(hook: CrudLifecycleContext<Service, Repository>) => unknown} [before]
 * @property {(hook: CrudLifecycleContext<Service, Repository>) => Promise<CrudJsonApiResult | null> | CrudJsonApiResult | null} [execute]
 * @property {(hook: CrudLifecycleContext<Service, Repository>) => unknown} [after]
 * @property {(hook: CrudLifecycleContext<Service, Repository>) => unknown} [afterCommit]
 */

/**
 * A CRUD feature's `operationLifecycle`: the hooks of each standard operation
 * that has any. Type a lifecycle declared apart from its feature with it:
 * `@type {CrudOperationLifecycle<BookingsService, BookingsRepository>}`.
 * @template [Service=CrudService]
 * @template [Repository=CrudRepository]
 * @typedef {{ list?: CrudLifecycleHooks<Service, Repository>, view?: CrudLifecycleHooks<Service, Repository>, create?: CrudLifecycleHooks<Service, Repository>, update?: CrudLifecycleHooks<Service, Repository>, delete?: CrudLifecycleHooks<Service, Repository> }} CrudOperationLifecycle
 */

export {};
