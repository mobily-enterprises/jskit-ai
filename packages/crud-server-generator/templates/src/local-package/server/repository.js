import { createWithTransaction } from "@jskit-ai/database-runtime/shared";
import { normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  buildJsonRestQueryParams,
  createJsonApiInputRecord,
  createJsonRestContext
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
    const normalizedRecordId = normalizeRecordId(recordId, { fallback: null });
    if (!normalizedRecordId) {
      return null;
    }

    try {
      return await api.resources.${option:namespace|camel}.get(
        {
          id: normalizedRecordId,
          queryParams: buildJsonRestQueryParams(RESOURCE_TYPE, {}, {
            include: options?.include
          }),
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
    const normalizedRecordId = normalizeRecordId(recordId, { fallback: null });
    if (!normalizedRecordId) {
      return null;
    }

    const sourcePatch = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
    if (Object.keys(sourcePatch).length < 1) {
      return getDocumentById(normalizedRecordId, options);
    }

    return api.resources.${option:namespace|camel}.patch(
      {
        inputRecord: createJsonApiInputRecord(
          RESOURCE_TYPE,
          {
            ...sourcePatch,
            updatedAt: new Date()
          },
          { id: normalizedRecordId }
        ),
        transaction: options?.trx || null,
        simplified: false
      },
      createJsonRestContext(options?.context || null)
    );
  }

  async function deleteDocumentById(recordId, options = {}) {
    const normalizedRecordId = normalizeRecordId(recordId, { fallback: null });
    if (!normalizedRecordId) {
      return null;
    }

    await api.resources.${option:namespace|camel}.delete(
      {
        id: normalizedRecordId,
        transaction: options?.trx || null,
        simplified: false
      },
      createJsonRestContext(options?.context || null)
    );

    return null;
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
