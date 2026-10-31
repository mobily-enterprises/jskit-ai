// The type of the capability a CRUD feature provides, for features that require it.

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

export {};
