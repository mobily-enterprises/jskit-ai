import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

const serviceEvents = Object.freeze({
  createRecord: Object.freeze([
    Object.freeze({
      type: "entity.changed",
      source: "crud",
      entity: "record",
      operation: "created",
      entityId: ({ result }) => result?.id,
      realtime: Object.freeze({
        event: "crud.record.changed",
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
        event: "crud.record.changed",
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
        event: "crud.record.changed",
        audience: "event_scope"
      })
    })
  ])
});

function createService({ crudRepository } = {}) {
  if (!crudRepository) {
    throw new Error("crudService requires crudRepository.");
  }

  async function listRecords(query = {}, options = {}) {
    return crudRepository.list(query, options);
  }

  async function getRecord(recordId, options = {}) {
    const record = await crudRepository.findById(recordId, options);
    if (!record) {
      throw new AppError(404, "Record not found.");
    }

    return record;
  }

  async function createRecord(payload = {}, options = {}) {
    const record = await crudRepository.create(payload, options);
    if (!record) {
      throw new Error("crudService could not load the created record.");
    }
    return record;
  }

  async function updateRecord(recordId, payload = {}, options = {}) {
    const record = await crudRepository.updateById(recordId, payload, options);
    if (!record) {
      throw new AppError(404, "Record not found.");
    }
    return record;
  }

  async function deleteRecord(recordId, options = {}) {
    const deleted = await crudRepository.deleteById(recordId, options);
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

export { createService, serviceEvents };
