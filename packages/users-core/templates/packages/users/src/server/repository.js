import { createWithTransaction } from "@jskit-ai/database-runtime/shared";
import { normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  buildJsonRestQueryParams,
  createJsonRestContext
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
    const normalizedRecordId = normalizeRecordId(recordId, { fallback: null });
    if (!normalizedRecordId) {
      return null;
    }

    try {
      return await api.resources.users.get(
        {
          id: normalizedRecordId,
          transaction: options?.trx || null,
          simplified: false
        },
        createJsonRestContext(options?.context || null)
      );
    } catch (error) {
      if (normalizeText(error?.code) === "REST_API_RESOURCE") {
        return null;
      }
      throw error;
    }
  }

  return Object.freeze({
    withTransaction,
    queryDocuments,
    getDocumentById
  });
}

export { createRepository };
