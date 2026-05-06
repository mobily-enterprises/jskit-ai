import { createWithTransaction } from "@jskit-ai/database-runtime/shared";
import {
  buildJsonRestQueryParams,
  createJsonApiInputRecord,
  createJsonRestContext,
  returnNullWhenJsonRestResourceMissing
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { resource } from "../../shared/googleRewardedUnlockReceiptResource.js";
const JSON_REST_SCOPE_NAME = "googleRewardedUnlockReceipts";

function createRepository({ api, knex } = {}) {
  const withTransaction = createWithTransaction(knex);

  async function queryDocuments(query = {}, options = {}) {
    return api.resources.googleRewardedUnlockReceipts.query(
      {
        queryParams: buildJsonRestQueryParams(JSON_REST_SCOPE_NAME, query),
        transaction: options?.trx || null,
        simplified: false
      },
      createJsonRestContext(options?.context || null)
    );
  }

  async function getDocumentById(recordId, options = {}) {
    return returnNullWhenJsonRestResourceMissing(() =>
      api.resources.googleRewardedUnlockReceipts.get(
        {
          id: recordId,
          queryParams: buildJsonRestQueryParams(JSON_REST_SCOPE_NAME, {}, {
            include: options?.include
          }),
          transaction: options?.trx || null,
          simplified: false
        },
        createJsonRestContext(options?.context || null)
      )
    );
  }

  async function createDocument(payload = {}, options = {}) {
    return api.resources.googleRewardedUnlockReceipts.post(
      {
        inputRecord: createJsonApiInputRecord(JSON_REST_SCOPE_NAME, payload, {
          resource
        }),
        transaction: options?.trx || null,
        simplified: false
      },
      createJsonRestContext(options?.context || null)
    );
  }

  async function patchDocumentById(recordId, patch = {}, options = {}) {
    const sourcePatch = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
    if (Object.keys(sourcePatch).length < 1) {
      return getDocumentById(recordId, options);
    }

    return returnNullWhenJsonRestResourceMissing(() =>
      api.resources.googleRewardedUnlockReceipts.patch(
        {
          id: recordId,
          inputRecord: createJsonApiInputRecord(
            JSON_REST_SCOPE_NAME,
            {
              ...sourcePatch,
              updatedAt: new Date()
            },
            {
              resource
            }
          ),
          transaction: options?.trx || null,
          simplified: false
        },
        createJsonRestContext(options?.context || null)
      )
    );
  }

  async function deleteDocumentById(recordId, options = {}) {
    return returnNullWhenJsonRestResourceMissing(async () => {
      await api.resources.googleRewardedUnlockReceipts.delete(
        {
          id: recordId,
          transaction: options?.trx || null,
          simplified: false
        },
        createJsonRestContext(options?.context || null)
      );

      return null;
    });
  }

  return Object.freeze({
    withTransaction,
    queryDocuments,
    getDocumentById,
    createDocument,
    patchDocumentById,
    deleteDocumentById
  });
}

export { createRepository };
