import { createCrudRepositoryFromResource } from "@jskit-ai/crud-core/server/createCrudRepositoryFromResource";
import { ${option:namespace|singular|camel}Resource } from "../shared/${option:namespace|singular|camel}Resource.js";

const createBaseRepository = createCrudRepositoryFromResource(${option:namespace|singular|camel}Resource, {
  context: "${option:namespace|snake} repository"
});

function createRepository(knex, options) {
  const base = createBaseRepository(knex, options);

  return Object.freeze({
    ...base,
    // async create(payload = {}, callOptions = {}) {
    //   return base.create(payload, callOptions);
    // }
  });
}

export { createRepository };
