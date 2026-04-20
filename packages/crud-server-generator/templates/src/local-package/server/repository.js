import { createCrudRepositoryRuntime } from "@jskit-ai/crud-core/server/repositoryOrm";
import { resource } from "../shared/${option:namespace|singular|camel}Resource.js";
import { LIST_CONFIG } from "./listConfig.js";

const REPOSITORY_CONFIG = Object.freeze({
  context: "${option:namespace|snake} repository",
  list: LIST_CONFIG
});

function createRepository(knex, options = {}) {
  const repositoryOrm = createCrudRepositoryRuntime(resource, knex, {
    ...options,
    ...REPOSITORY_CONFIG
  });

  async function list(query = {}, callOptions = {}) {
    return repositoryOrm.list(query, callOptions);
  }

  async function findById(recordId, callOptions = {}) {
    return repositoryOrm.findById(recordId, callOptions);
  }

  async function listByIds(ids = [], callOptions = {}) {
    return repositoryOrm.listByIds(ids, callOptions);
  }

  async function listByForeignIds(ids = [], foreignKey = "", callOptions = {}) {
    return repositoryOrm.listByForeignIds(ids, foreignKey, callOptions);
  }

  async function create(payload = {}, callOptions = {}) {
    return repositoryOrm.create(payload, callOptions);
  }

  async function updateById(recordId, patch = {}, callOptions = {}) {
    return repositoryOrm.updateById(recordId, patch, callOptions);
  }

  async function deleteById(recordId, callOptions = {}) {
    return repositoryOrm.deleteById(recordId, callOptions);
  }

  return Object.freeze({
    withTransaction: repositoryOrm.withTransaction,
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
