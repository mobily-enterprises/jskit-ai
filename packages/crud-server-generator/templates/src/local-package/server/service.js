import { createCrudServiceEvents } from "@jskit-ai/crud-core/server/serviceEvents";
import {
  createCrudServiceRuntime,
  crudServiceListRecords,
  crudServiceGetRecord,
  crudServiceCreateRecord,
  crudServiceUpdateRecord,
  crudServiceDeleteRecord
} from "@jskit-ai/crud-core/server/serviceMethods";
import { resource } from "../shared/${option:namespace|singular|camel}Resource.js";

const serviceRuntime = createCrudServiceRuntime(resource, {
  context: "${option:namespace|camel}Service"
});
const baseServiceEvents = createCrudServiceEvents(resource, {
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
  async function listRecords(query = {}, options = {}) {
    return crudServiceListRecords(serviceRuntime, ${option:namespace|camel}Repository, fieldAccess, query, options);
  }

  async function getRecord(recordId, options = {}) {
    return crudServiceGetRecord(serviceRuntime, ${option:namespace|camel}Repository, fieldAccess, recordId, options);
  }

  async function createRecord(payload = {}, options = {}) {
    return crudServiceCreateRecord(serviceRuntime, ${option:namespace|camel}Repository, fieldAccess, payload, options);
  }

  async function updateRecord(recordId, payload = {}, options = {}) {
    return crudServiceUpdateRecord(serviceRuntime, ${option:namespace|camel}Repository, fieldAccess, recordId, payload, options);
  }

  async function deleteRecord(recordId, options = {}) {
    return crudServiceDeleteRecord(serviceRuntime, ${option:namespace|camel}Repository, fieldAccess, recordId, options);
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
