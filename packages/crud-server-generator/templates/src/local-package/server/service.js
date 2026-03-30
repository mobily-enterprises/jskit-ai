import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { createCrudServiceEvents } from "@jskit-ai/crud-core/server/serviceEvents";
import { resource } from "../shared/${option:namespace|singular|camel}Resource.js";

const baseServiceEvents = createCrudServiceEvents(resource, {
  context: "${option:namespace|camel}Service"
});

const serviceEvents = Object.freeze({
  createRecord: [...baseServiceEvents.createRecord],
  updateRecord: [...baseServiceEvents.updateRecord],
  deleteRecord: [...baseServiceEvents.deleteRecord]
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

// Optional event override example:
// const serviceEvents = {
//   ...baseServiceEvents,
//   createRecord: [
//     ...baseServiceEvents.createRecord,
//     {
//       type: "${option:namespace|snake}.custom",
//       source: "custom",
//       entity: "record",
//       operation: "created",
//       entityId: ({ result }) => result?.id
//     }
//   ]
// };

export { createService, serviceEvents };
