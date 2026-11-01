import {
  createCrudServiceRuntime,
  crudServiceListRecords,
  crudServiceGetRecord,
  crudServiceCreateRecord,
  crudServiceUpdateRecord,
  crudServiceDeleteRecord
} from "./serviceMethods.js";

/**
 * A records service factory for one resource.
 * @param {import("./types.js").CrudResourceDefinition} resource
 * @param {{ context?: string }} [options] The name the service's errors give it.
 */
function createCrudServiceFromResource(resource, { context = "crudService" } = {}) {
  const runtime = createCrudServiceRuntime(resource, { context });

  /**
   * @param {object} dependencies
   * @param {import("./types.js").CrudRecordRepository} dependencies.repository
   * @param {import("./types.js").CrudFieldAccess} [dependencies.fieldAccess] Defaults to no field restrictions.
   */
  function createBaseService({ repository, fieldAccess = {} }) {
    // readable-check: allow required-collaborators - test asserts error: createBaseService refuses a missing repository
    if (!repository) {
      throw new Error(`${context} requires repository.`);
    }

    async function listRecords(query = {}, options = {}) {
      return crudServiceListRecords(runtime, repository, fieldAccess, query, options);
    }

    async function getRecord(recordId, options = {}) {
      return crudServiceGetRecord(runtime, repository, fieldAccess, recordId, options);
    }

    async function createRecord(payload = {}, options = {}) {
      return crudServiceCreateRecord(runtime, repository, fieldAccess, payload, options);
    }

    async function updateRecord(recordId, payload = {}, options = {}) {
      return crudServiceUpdateRecord(runtime, repository, fieldAccess, recordId, payload, options);
    }

    async function deleteRecord(recordId, options = {}) {
      return crudServiceDeleteRecord(runtime, repository, fieldAccess, recordId, options);
    }

    return Object.freeze({
      listRecords,
      getRecord,
      createRecord,
      updateRecord,
      deleteRecord
    });
  }

  return Object.freeze({
    createBaseService
  });
}

export { createCrudServiceFromResource };
