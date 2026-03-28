import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import {
  requireCrudNamespace,
  resolveCrudRecordChangedEvent
} from "../shared/crudNamespaceSupport.js";

function createCrudServiceFromResource(resource = {}, { context = "crudService" } = {}) {
  const namespace = requireCrudNamespace(resource?.resource, { context: `${context} resource.resource` });
  const recordChangedEventName = resolveCrudRecordChangedEvent(namespace);
  const baseServiceEvents = Object.freeze({
    createRecord: Object.freeze([
      Object.freeze({
        type: "entity.changed",
        source: "crud",
        entity: "record",
        operation: "created",
        entityId: ({ result }) => result?.id,
        realtime: Object.freeze({
          event: recordChangedEventName,
          audience: "event_scope"
        })
      })
    ]),
    updateRecord: Object.freeze([
      Object.freeze({
        type: "entity.changed",
        source: "crud",
        entity: "record",
        operation: "updated",
        entityId: ({ result }) => result?.id,
        realtime: Object.freeze({
          event: recordChangedEventName,
          audience: "event_scope"
        })
      })
    ]),
    deleteRecord: Object.freeze([
      Object.freeze({
        type: "entity.changed",
        source: "crud",
        entity: "record",
        operation: "deleted",
        entityId: ({ result }) => result?.id,
        realtime: Object.freeze({
          event: recordChangedEventName,
          audience: "event_scope"
        })
      })
    ])
  });

  function createBaseService({ repository } = {}) {
    if (!repository) {
      throw new Error(`${context} requires repository.`);
    }

    async function listRecords(query = {}, options = {}) {
      return repository.list(query, options);
    }

    async function getRecord(recordId, options = {}) {
      const record = await repository.findById(recordId, options);
      if (!record) {
        throw new AppError(404, "Record not found.");
      }

      return record;
    }

    async function createRecord(payload = {}, options = {}) {
      const record = await repository.create(payload, options);
      if (!record) {
        throw new Error(`${namespace}Service could not load the created record.`);
      }
      return record;
    }

    async function updateRecord(recordId, payload = {}, options = {}) {
      const record = await repository.updateById(recordId, payload, options);
      if (!record) {
        throw new AppError(404, "Record not found.");
      }
      return record;
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
