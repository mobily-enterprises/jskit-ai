import { createWithTransaction } from "@jskit-ai/database-runtime/shared";
import {
  buildJsonRestQueryParams,
  createJsonApiInputRecord,
  createJsonRestContext,
  returnBadRequestWhenJsonRestFieldsetInvalid,
  returnNullWhenJsonRestResourceMissing
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";

function createCrudJsonApiRepository({ api, knex, resource, resourceScopeName } = {}) {
  if (!api) {
    throw new TypeError("createCrudJsonApiRepository requires api.");
  }
  if (!knex) {
    throw new TypeError("createCrudJsonApiRepository requires knex.");
  }
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
    throw new TypeError("createCrudJsonApiRepository requires resource.");
  }
  const scopeName = String(resourceScopeName || "").trim();
  if (!scopeName) {
    throw new TypeError("createCrudJsonApiRepository requires resourceScopeName.");
  }

  const withTransaction = createWithTransaction(knex);

  function requireApiResource() {
    const apiResource = api.resources?.[scopeName];
    if (!apiResource) {
      throw new Error(`JSON REST resource "${scopeName}" is not registered.`);
    }
    return apiResource;
  }

  async function queryDocuments(query = {}, options = {}) {
    return returnBadRequestWhenJsonRestFieldsetInvalid(() =>
      requireApiResource().query(
        {
          queryParams: buildJsonRestQueryParams(scopeName, query),
          transaction: options.trx || null,
          simplified: false
        },
        createJsonRestContext(options.context || null)
      )
    );
  }

  async function getDocumentById(recordId, query = {}, options = {}) {
    return returnBadRequestWhenJsonRestFieldsetInvalid(() =>
      returnNullWhenJsonRestResourceMissing(() =>
        requireApiResource().get(
          {
            id: recordId,
            queryParams: buildJsonRestQueryParams(scopeName, query),
            transaction: options.trx || null,
            simplified: false
          },
          createJsonRestContext(options.context || null)
        )
      )
    );
  }

  async function createDocument(payload = {}, options = {}) {
    return requireApiResource().post(
      {
        inputRecord: createJsonApiInputRecord(scopeName, payload, { resource }),
        transaction: options.trx || null,
        simplified: false
      },
      createJsonRestContext(options.context || null)
    );
  }

  async function patchDocumentById(recordId, patch = {}, options = {}) {
    const sourcePatch = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
    if (Object.keys(sourcePatch).length < 1) {
      return getDocumentById(recordId, {}, options);
    }

    return returnNullWhenJsonRestResourceMissing(() =>
      requireApiResource().patch(
        {
          id: recordId,
          inputRecord: createJsonApiInputRecord(scopeName, sourcePatch, { resource }),
          transaction: options.trx || null,
          simplified: false
        },
        createJsonRestContext(options.context || null)
      )
    );
  }

  async function deleteDocumentById(recordId, options = {}) {
    return returnNullWhenJsonRestResourceMissing(async () => {
      await requireApiResource().delete(
        {
          id: recordId,
          transaction: options.trx || null,
          simplified: false
        },
        createJsonRestContext(options.context || null)
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

export { createCrudJsonApiRepository };
