import {
  createCrudRepositoryRuntime,
  crudRepositoryList,
  crudRepositoryFindById,
  crudRepositoryListByIds,
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

    async function listRecords(query = {}, callOptions = {}) {
      return crudRepositoryList(runtime, knex, query, options, callOptions);
    }

    async function findById(recordId, callOptions = {}) {
      return crudRepositoryFindById(runtime, knex, recordId, options, callOptions);
    }

    async function listByIds(ids = [], callOptions = {}) {
      return crudRepositoryListByIds(runtime, knex, ids, options, callOptions);
    }

    async function create(payload = {}, callOptions = {}) {
      return crudRepositoryCreate(runtime, knex, payload, options, callOptions);
    }

    async function updateById(recordId, patch = {}, callOptions = {}) {
      return crudRepositoryUpdateById(runtime, knex, recordId, patch, options, callOptions);
    }

    async function deleteById(recordId, callOptions = {}) {
      return crudRepositoryDeleteById(runtime, knex, recordId, options, callOptions);
    }

    return Object.freeze({
      list: listRecords,
      findById,
      listByIds,
      create,
      updateById,
      deleteById
    });
  };
}

export { createCrudRepositoryFromResource };
