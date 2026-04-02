import {
  createCrudRepositoryRuntime,
  crudRepositoryList,
  crudRepositoryFindById,
  crudRepositoryListByIds,
  crudRepositoryListByForeignIds,
  crudRepositoryCreate,
  crudRepositoryUpdateById,
  crudRepositoryDeleteById
} from "./repositoryMethods.js";

function createCrudRepositoryFromResource(resource = {}, { context = "crudRepository", list = {} } = {}) {
  const runtime = createCrudRepositoryRuntime(resource, {
    context,
    list
  });

  return function createRepository(knex, options = {}) {
    if (typeof knex !== "function") {
      throw new TypeError("crudRepository requires knex.");
    }

    async function listRecords(query = {}, callOptions = {}, hooks = null) {
      return crudRepositoryList(runtime, knex, query, options, callOptions, hooks);
    }

    async function findById(recordId, callOptions = {}, hooks = null) {
      return crudRepositoryFindById(runtime, knex, recordId, options, callOptions, hooks);
    }

    async function listByIds(ids = [], callOptions = {}, hooks = null) {
      return crudRepositoryListByIds(runtime, knex, ids, options, callOptions, hooks);
    }

    async function listByForeignIds(ids = [], foreignKey = "", callOptions = {}, hooks = null) {
      return crudRepositoryListByForeignIds(runtime, knex, ids, foreignKey, options, callOptions, hooks);
    }

    async function create(payload = {}, callOptions = {}, hooks = null) {
      return crudRepositoryCreate(runtime, knex, payload, options, callOptions, hooks);
    }

    async function updateById(recordId, patch = {}, callOptions = {}, hooks = null) {
      return crudRepositoryUpdateById(runtime, knex, recordId, patch, options, callOptions, hooks);
    }

    async function deleteById(recordId, callOptions = {}, hooks = null) {
      return crudRepositoryDeleteById(runtime, knex, recordId, options, callOptions, hooks);
    }

    return Object.freeze({
      list: listRecords,
      findById,
      listByIds,
      listByForeignIds,
      create,
      updateById,
      deleteById
    });
  };
}

export { createCrudRepositoryFromResource };
