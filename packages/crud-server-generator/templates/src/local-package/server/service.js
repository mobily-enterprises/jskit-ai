import { createCrudServiceFromResource } from "@jskit-ai/crud-core/server/createCrudServiceFromResource";
import { ${option:namespace|singular|camel}Resource } from "../shared/${option:namespace|singular|camel}Resource.js";

const { createBaseService, baseServiceEvents } = createCrudServiceFromResource(${option:namespace|singular|camel}Resource, {
  context: "${option:namespace|camel}Service"
});

const serviceEvents = baseServiceEvents;

function createService({ ${option:namespace|camel}Repository } = {}) {
  const base = createBaseService({
    repository: ${option:namespace|camel}Repository
  });

  return Object.freeze({
    ...base,
    // async createRecord(payload = {}, options = {}) {
    //   return base.createRecord(payload, options);
    // }
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
