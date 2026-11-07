// The types of the resource runtime: `runtime.resources`, its handles and contexts.

/**
 * The json-rest-api host createResourceHost builds. Its Knex plugin adds
 * `knex.helpers.getStorageAdapter(scopeName)`: a registered resource's table
 * query, id column and field columns.
 * @typedef {Awaited<ReturnType<typeof import("./resourceHost.js").createResourceHost>> & {
 *   knex: { instance: import("knex").Knex, helpers: { getStorageAdapter(scopeName: string): NonNullable<import("json-rest-api").HookContext["storageAdapter"]> } }
 * }} RuntimeJsonRestApi
 */

/**
 * One of `api.resources`: json-rest-api's resource and its methods. query()
 * and delete() take any params, because the transitional readers pass params
 * json-rest-api does not declare.
 * @typedef {import("json-rest-api").RuntimeResource
 *   & Omit<import("json-rest-api").ResourceCoreMethods, "query" | "delete">
 *   & {
 *     query(params?: object, context?: object): Promise<any>,
 *     delete(params: object, context?: object): Promise<void>
 *   }} JsonRestResource
 */

/**
 * The `runtime.resources` capability.
 * @typedef {ReturnType<typeof import("./resourceRuntime.js").createResourceRuntime>} ResourceRuntime
 */

/**
 * One owned table's handle: its reads, writes, locks and read-only escape hatch,
 * each scoped by the call's `options.context`.
 * @typedef {ReturnType<typeof import("./resourceHandle.js").createResourceHandle>} ResourceHandle
 */

/**
 * The options every handle call takes last: the caller's context (an action's,
 * or a system context) and the transaction to join.
 * @typedef {{ context?: object | null, trx?: object | null }} ResourceCallOptions
 */

/**
 * A context for work across every workspace and user, from `systemContext(reason)`.
 * `forWorkspace(id)` and `forUser(id)` derive the context of one workspace or user.
 * @typedef {ReturnType<typeof import("./contexts.js").createSystemContext>} SystemContext
 */

export {};
