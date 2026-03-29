import {
  createCrudRepositoryRuntime,
  crudRepositoryList,
  crudRepositoryFindById,
  crudRepositoryCreate,
  crudRepositoryUpdateById,
  crudRepositoryDeleteById
} from "@jskit-ai/crud-core/server/repositoryMethods";
import { ${option:namespace|singular|camel}Resource } from "../shared/${option:namespace|singular|camel}Resource.js";

const LIST_CONFIG = Object.freeze({
  // defaultLimit: 20,
  // maxLimit: 100,
  // searchColumns: ["name"]
});

const repositoryRuntime = createCrudRepositoryRuntime(${option:namespace|singular|camel}Resource, {
  context: "${option:namespace|snake} repository",
  list: LIST_CONFIG
});

function createRepository(knex, options = {}) {
  if (typeof knex !== "function") {
    throw new TypeError("crudRepository requires knex.");
  }

  async function list(query = {}, callOptions = {}) {
    return crudRepositoryList(repositoryRuntime, knex, query, options, callOptions);
  }

  async function findById(recordId, callOptions = {}) {
    return crudRepositoryFindById(repositoryRuntime, knex, recordId, options, callOptions);
  }

  async function create(payload = {}, callOptions = {}) {
    return crudRepositoryCreate(repositoryRuntime, knex, payload, options, callOptions);
  }

  async function updateById(recordId, patch = {}, callOptions = {}) {
    return crudRepositoryUpdateById(repositoryRuntime, knex, recordId, patch, options, callOptions);
  }

  async function deleteById(recordId, callOptions = {}) {
    return crudRepositoryDeleteById(repositoryRuntime, knex, recordId, options, callOptions);
  }

  return Object.freeze({
    list,
    findById,
    create,
    updateById,
    deleteById
  });
}

export { createRepository };
