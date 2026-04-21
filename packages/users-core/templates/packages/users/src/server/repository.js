import { createCrudResourceRuntime } from "@jskit-ai/crud-core/server/resourceRuntime";
import { resource } from "../shared/userResource.js";
import { LIST_CONFIG } from "./listConfig.js";

const REPOSITORY_CONFIG = Object.freeze({
  context: "users repository",
  list: LIST_CONFIG
});

function createRepository(knex, options = {}) {
  const resourceRuntime = createCrudResourceRuntime(resource, knex, {
    ...options,
    ...REPOSITORY_CONFIG
  });

  async function list(query = {}, callOptions = {}) {
    return resourceRuntime.list(query, callOptions);
  }

  async function findById(recordId, callOptions = {}) {
    return resourceRuntime.findById(recordId, callOptions);
  }

  async function listByIds(ids = [], callOptions = {}) {
    return resourceRuntime.listByIds(ids, callOptions);
  }

  async function listByForeignIds(ids = [], foreignKey = "", callOptions = {}) {
    return resourceRuntime.listByForeignIds(ids, foreignKey, callOptions);
  }

  return Object.freeze({
    withTransaction: resourceRuntime.withTransaction,
    list,
    findById,
    listByIds,
    listByForeignIds
  });
}

export { createRepository };
