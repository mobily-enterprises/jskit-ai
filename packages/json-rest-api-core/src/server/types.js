// The type of the `runtime.json-rest-api` capability, for features that require it.

/** @typedef {Awaited<ReturnType<typeof import("./jsonRestApiHost.js").createJsonRestApiHost>>} RuntimeJsonRestApi */

// One of `api.resources`: json-rest-api's resource and its CRUD methods. query()
// and delete() take any params until crud-core's calls match the params json-rest-api
// declares: buildJsonRestQueryParams() builds filters as an untyped object and
// page.size as text, and crud-core's deleteDocumentById() passes a returning option.
/**
 * @typedef {import("json-rest-api").RuntimeResource
 *   & Omit<import("json-rest-api").ResourceCoreMethods, "query" | "delete">
 *   & {
 *     query(params?: object, context?: object): Promise<any>,
 *     delete(params: object, context?: object): Promise<void>
 *   }} JsonRestResource
 */

export {};
