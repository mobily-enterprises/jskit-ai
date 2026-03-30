import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { requireCrudNamespace } from "../shared/crudNamespaceSupport.js";
import { createCrudFieldAccessRuntime } from "./fieldAccess.js";
import { createCrudServiceEvents } from "./serviceEvents.js";

function createCrudServiceFromResource(resource = {}, { context = "crudService" } = {}) {
  const namespace = requireCrudNamespace(resource?.resource, { context: `${context} resource.resource` });
  const baseServiceEvents = createCrudServiceEvents(resource, { context });
  const fieldAccessRuntime = createCrudFieldAccessRuntime(resource, { context });

  function createBaseService({ repository, fieldAccess = {} } = {}) {
    if (!repository) {
      throw new Error(`${context} requires repository.`);
    }

    async function listRecords(query = {}, options = {}) {
      const result = await repository.list(query, options);
      return fieldAccessRuntime.filterReadableListResult(result, fieldAccess, {
        action: "list",
        query,
        options,
        context: options?.context
      });
    }

    async function getRecord(recordId, options = {}) {
      const record = await repository.findById(recordId, options);
      if (!record) {
        throw new AppError(404, "Record not found.");
      }

      return fieldAccessRuntime.filterReadableRecord(record, fieldAccess, {
        action: "view",
        recordId,
        options,
        context: options?.context
      });
    }

    async function createRecord(payload = {}, options = {}) {
      const writablePayload = await fieldAccessRuntime.enforceWritablePayload(payload, fieldAccess, {
        action: "create",
        payload,
        options,
        context: options?.context
      });
      const record = await repository.create(writablePayload, options);
      if (!record) {
        throw new Error(`${namespace}Service could not load the created record.`);
      }
      return fieldAccessRuntime.filterReadableRecord(record, fieldAccess, {
        action: "create",
        options,
        context: options?.context
      });
    }

    async function updateRecord(recordId, payload = {}, options = {}) {
      const writablePayload = await fieldAccessRuntime.enforceWritablePayload(payload, fieldAccess, {
        action: "update",
        recordId,
        payload,
        options,
        context: options?.context
      });
      const record = await repository.updateById(recordId, writablePayload, options);
      if (!record) {
        throw new AppError(404, "Record not found.");
      }
      return fieldAccessRuntime.filterReadableRecord(record, fieldAccess, {
        action: "update",
        recordId,
        options,
        context: options?.context
      });
    }

    async function deleteRecord(recordId, options = {}) {
      const deleted = await repository.deleteById(recordId, options);
      if (!deleted) {
        throw new AppError(404, "Record not found.");
      }
      return deleted;
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
