// The CRUD API names the data-access redesign removed, each with its replacement, so code written for the earlier
// API fails where it names one instead of being silently ignored or reading undefined.

// Repository methods of the earlier CRUD repository and its helpers, and what a table's handle offers instead.
const LEGACY_REPOSITORY_METHODS = Object.freeze({
  queryDocuments: "query({ page: { size } }, options)",
  getDocumentById: "get(id, params, options)",
  queryAllJsonRestCollectionRows: "queryAll(params, options)",
  queryEveryDocument: "queryAll(params, options)",
  createDocument: "create(attributes, options)",
  createDocuments: "createMany(rows, options)",
  patchDocumentById: "patch(id, changes, options)",
  patchDocumentIfLockVersion: "patch(id, changes, { ...options, lockVersion })",
  deleteDocumentById: "delete(id, options)",
  applyForUpdate: "lock(id, txOptions) inside withTransaction",
  lockScopedRecordId: "lock(id, txOptions) inside withTransaction",
  runInTransaction: "withTransaction(options, (txOptions) => ...)",
  createWithTransaction: "withTransaction(options, (txOptions) => ...)",
  joinOrOpenTransaction: "withTransaction(options, (txOptions) => ...)",
  resolveTransaction: "withTransaction(options, (txOptions) => ...)",
  resolveQueryOptions: "the options every handle call takes last",
  resolveRepoClient: "withTransaction(options, (txOptions) => ...)"
});

// Methods of the earlier CRUD services, and the CRUD service method the routes and actions now call instead.
const LEGACY_SERVICE_METHODS = Object.freeze({
  queryDocuments: "list(query, options)",
  queryEveryDocument: "list(query, options), or the repository's queryAll(params, options) for every record",
  getDocumentById: "view(recordId, query, options)",
  createDocument: "create(payload, options)",
  patchDocumentById: "patch(recordId, payload, options)",
  deleteDocumentById: "delete(recordId, options)",
  listRecords: "list(query, options)",
  getRecord: "view(recordId, query, options)",
  createRecord: "create(payload, options)",
  updateRecord: "patch(recordId, payload, options)",
  deleteRecord: "delete(recordId, options)"
});

/**
 * Refuses a decorated repository or service that still defines a method of the
 * earlier API: nothing calls it any more, so its behaviour would be lost.
 * @param {object} target
 * @param {Readonly<Record<string, string>>} legacyMethods
 * @param {string} label What returned the target, for the message.
 */
function rejectLegacyMethods(target, legacyMethods, label) {
  if (!target || typeof target !== "object") {
    return target;
  }
  const found = Object.keys(legacyMethods).filter((name) => name in target);
  if (found.length > 0) {
    throw new TypeError(
      `${label} defines ${found.map((name) => `${name}()`).join(", ")}, which nothing calls since the data-access ` +
      `redesign, so its behaviour would be lost. Rename each to its replacement: ` +
      `${found.map((name) => `${name}() is now ${legacyMethods[name]}`).join("; ")}.`
    );
  }
  return target;
}

/**
 * Gives `target` a non-enumerable getter for each removed property it does not
 * hold, which throws naming the replacement. Spreading the target skips them;
 * reading one, as destructuring does, throws. Call it before freezing.
 * @template {object} T
 * @param {T} target
 * @param {Readonly<Record<string, string>>} removed Each removed name and what replaced it.
 * @param {string} label What the target is, for the message.
 * @returns {T}
 */
function withRemovedProperties(target, removed, label) {
  for (const [name, replacement] of Object.entries(removed)) {
    if (Object.hasOwn(target, name)) {
      continue;
    }
    Object.defineProperty(target, name, {
      enumerable: false,
      get() {
        throw new TypeError(`${label} no longer has ${name}: ${replacement}`);
      }
    });
  }
  return target;
}

export { LEGACY_REPOSITORY_METHODS, LEGACY_SERVICE_METHODS, rejectLegacyMethods, withRemovedProperties };
