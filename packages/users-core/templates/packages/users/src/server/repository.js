import { createWithTransaction } from "@jskit-ai/database-runtime/shared";
import {
  buildJsonRestQueryParams,
  createJsonRestContext,
  returnNullWhenJsonRestResourceMissing
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { resource } from "../shared/userResource.js";

const RESOURCE_TYPE = resource.namespace;

function createRepository({ api, knex } = {}) {
  const withTransaction = createWithTransaction(knex);

  async function queryDocuments(query = {}, options = {}) {
    return api.resources.users.query(
      {
        queryParams: buildJsonRestQueryParams(RESOURCE_TYPE, query),
        transaction: options?.trx || null,
        simplified: false
      },
      createJsonRestContext(options?.context || null)
    );
  }

  async function getDocumentById(recordId, options = {}) {
    return returnNullWhenJsonRestResourceMissing(() =>
      api.resources.users.get(
        {
          id: recordId,
          queryParams: buildJsonRestQueryParams(RESOURCE_TYPE, {}, {
            include: options?.include
          }),
          transaction: options?.trx || null,
          simplified: false
        },
        createJsonRestContext(options?.context || null)
      )
    );
  }

  return Object.freeze({
    withTransaction,
    queryDocuments,
    getDocumentById
  });
}

export { createRepository };
