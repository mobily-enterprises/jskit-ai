import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
const servicePermissions = Object.freeze({
  listRecords: Object.freeze({
    require: "authenticated"
  }),
  getRecord: Object.freeze({
    require: "authenticated"
  }),
  createRecord: Object.freeze({
    require: "authenticated"
  }),
  updateRecord: Object.freeze({
    require: "authenticated"
  }),
  deleteRecord: Object.freeze({
    require: "authenticated"
  })
});

const serviceEvents = Object.freeze({
  createRecord: Object.freeze([
    Object.freeze({
      type: "entity.changed",
      source: "crud",
      entity: "record",
      operation: "created",
      entityId: ({ result }) => result?.id,
      realtime: Object.freeze({
        event: "${option:namespace|snake}.record.changed",
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
        event: "${option:namespace|snake}.record.changed",
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
        event: "${option:namespace|snake}.record.changed",
        audience: "event_scope"
      })
    })
  ])
});

function createService({ ${option:namespace|camel}Repository } = {}) {
  if (!${option:namespace|camel}Repository) {
    throw new Error("${option:namespace|camel}Service requires ${option:namespace|camel}Repository.");
  }

  async function listRecords(query = {}, options = {}) {
    return ${option:namespace|camel}Repository.list(query, options);
  }

  async function getRecord(recordId, options = {}) {
    const record = await ${option:namespace|camel}Repository.findById(recordId, options);
    if (!record) {
      throw new AppError(404, "Record not found.");
    }

    return record;
  }

  async function createRecord(payload = {}, options = {}) {
    const record = await ${option:namespace|camel}Repository.create(payload, options);
    if (!record) {
      throw new Error("${option:namespace|camel}Service could not load the created record.");
    }
    return record;
  }

  async function updateRecord(recordId, payload = {}, options = {}) {
    const record = await ${option:namespace|camel}Repository.updateById(recordId, payload, options);
    if (!record) {
      throw new AppError(404, "Record not found.");
    }
    return record;
  }

  async function deleteRecord(recordId, options = {}) {
    const deleted = await ${option:namespace|camel}Repository.deleteById(recordId, options);
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

export { createService, servicePermissions, serviceEvents };
