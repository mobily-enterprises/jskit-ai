import { createCrudServiceEvents } from "./serviceEvents.js";
import {
  createCrudServiceRuntime,
  crudServiceListRecords,
  crudServiceGetRecord,
  crudServiceCreateRecord,
  crudServiceUpdateRecord,
  crudServiceDeleteRecord
} from "./serviceMethods.js";

function createCrudServiceFromResource(resource = {}, { context = "crudService" } = {}) {
  const runtime = createCrudServiceRuntime(resource, { context });
  const baseServiceEvents = createCrudServiceEvents(resource, { context });

  function createBaseService({ repository, fieldAccess = {} } = {}) {
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
    createBaseService,
    baseServiceEvents
  });
}

export { createCrudServiceFromResource };
