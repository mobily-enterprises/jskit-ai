import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { createCrudServiceEvents } from "@jskit-ai/crud-core/server/serviceEvents";
import { createCrudFieldAccessRuntime } from "@jskit-ai/crud-core/server/fieldAccess";
import { resource } from "../shared/${option:namespace|singular|camel}Resource.js";

const baseServiceEvents = createCrudServiceEvents(resource, {
  context: "${option:namespace|camel}Service"
});
const fieldAccessRuntime = createCrudFieldAccessRuntime(resource, {
  context: "${option:namespace|camel}Service"
});

const serviceEvents = Object.freeze({
  createRecord: [...baseServiceEvents.createRecord],
  updateRecord: [...baseServiceEvents.updateRecord],
  deleteRecord: [...baseServiceEvents.deleteRecord]
});

const DEFAULT_FIELD_ACCESS = Object.freeze({
  // Tip: use createFieldAccessForRoleMatrix(...) from @jskit-ai/crud-core/server/fieldAccess to centralize role matrices.
  // Example:
  // const DEFAULT_FIELD_ACCESS = createFieldAccessForRoleMatrix({
  //   default: {
  //     readable: { list: ["id", "name"], view: ["id", "name", "email"] },
  //     writable: { create: ["name", "email"], update: ["name"] }
  //   },
  //   admin: {
  //     readable: "*",
  //     writable: "*"
  //   },
  //   writeMode: "throw" // or "strip"
  // });
  // readable: ({ action, context }) => ["id", "name"], // null/"*" means no read filtering
  // Read redaction behavior: drop optional fields; use null/default for required fields.
  // writable: ({ action, context }) => ["name"], // null/"*" means no write filtering
  // writeMode: "throw" // "throw" (default) or "strip"
});

function createService({ ${option:namespace|camel}Repository, fieldAccess = DEFAULT_FIELD_ACCESS } = {}) {
  if (!${option:namespace|camel}Repository) {
    throw new Error("${option:namespace|camel}Service requires ${option:namespace|camel}Repository.");
  }

  async function listRecords(query = {}, options = {}) {
    const result = await ${option:namespace|camel}Repository.list(query, options);
    return fieldAccessRuntime.filterReadableListResult(result, fieldAccess, {
      action: "list",
      query,
      options,
      context: options?.context
    });
  }

  async function getRecord(recordId, options = {}) {
    const record = await ${option:namespace|camel}Repository.findById(recordId, options);
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
    const record = await ${option:namespace|camel}Repository.create(writablePayload, options);
    if (!record) {
      throw new Error("${option:namespace|camel}Service could not load the created record.");
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
    const record = await ${option:namespace|camel}Repository.updateById(recordId, writablePayload, options);
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
