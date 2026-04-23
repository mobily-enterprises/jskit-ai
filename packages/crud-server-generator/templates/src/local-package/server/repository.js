import { createCrudResourceRuntime } from "@jskit-ai/crud-core/server/resourceRuntime";
import { resource } from "../shared/${option:namespace|singular|camel}Resource.js";
import { LIST_CONFIG } from "./listConfig.js";

const REPOSITORY_CONTEXT = "${option:namespace|snake} repository";

const REPOSITORY_CONFIG = Object.freeze({
  context: REPOSITORY_CONTEXT,
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

  async function create(payload = {}, callOptions = {}) {
    return resourceRuntime.create(payload, callOptions);
  }

  async function updateById(recordId, patch = {}, callOptions = {}) {
    return resourceRuntime.updateById(recordId, patch, callOptions);
  }

  async function deleteById(recordId, callOptions = {}) {
    return resourceRuntime.deleteById(recordId, callOptions);
  }

  return Object.freeze({
    withTransaction: resourceRuntime.withTransaction,
    list,
    findById,
    listByIds,
    listByForeignIds,
    create,
    updateById,
    deleteById
  });
}

export { createRepository };
