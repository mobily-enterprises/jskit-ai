import { createWithTransaction } from "@jskit-ai/database-runtime/shared";
import {
  buildJsonRestQueryParams,
  createJsonApiInputRecord,
  createJsonRestContext,
  returnNullWhenJsonRestResourceMissing
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { resource } from "../shared/${option:namespace|singular|camel}Resource.js";
const RESOURCE_TYPE = resource.namespace;

function createRepository({ api, knex } = {}) {
  const withTransaction = createWithTransaction(knex);

  async function queryDocuments(query = {}, options = {}) {
    return api.resources.${option:namespace|camel}.query(
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
      api.resources.${option:namespace|camel}.get(
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

  async function createDocument(payload = {}, options = {}) {
    return api.resources.${option:namespace|camel}.post(
      {
        inputRecord: createJsonApiInputRecord(RESOURCE_TYPE, payload),
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
      api.resources.${option:namespace|camel}.patch(
        {
          id: recordId,
          inputRecord: createJsonApiInputRecord(
            RESOURCE_TYPE,
            {
              ...sourcePatch,
              updatedAt: new Date()
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
      await api.resources.${option:namespace|camel}.delete(
        {
          id: recordId,
          transaction: options?.trx || null,
          simplified: false
        },
        createJsonRestContext(options?.context || null)
      );

      return true;
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
