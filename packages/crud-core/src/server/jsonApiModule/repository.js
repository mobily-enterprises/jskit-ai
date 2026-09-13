import {
  buildJsonRestQueryParams,
  createJsonRestContext,
  returnBadRequestWhenJsonRestFieldsetInvalid,
  returnNullWhenJsonRestResourceMissing
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";

function createCrudJsonApiRepository({ api, resource, resourceScopeName } = {}) {
  if (!api) {
    throw new TypeError("createCrudJsonApiRepository requires api.");
  }
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
    throw new TypeError("createCrudJsonApiRepository requires resource.");
  }
  const scopeName = String(resourceScopeName || "").trim();
  if (!scopeName) {
    throw new TypeError("createCrudJsonApiRepository requires resourceScopeName.");
  }

  function withTransaction(work) {
    return api.transaction(work);
  }

  function inputData(payload) {
    const data = { ...payload };
    for (const [fieldName, definition] of Object.entries(resource.schema || {})) {
      if (!definition?.belongsTo || !Object.hasOwn(data, fieldName)) {
        continue;
      }
      const relationshipName = definition.as || fieldName;
      if (relationshipName === fieldName) {
        continue;
      }
      if (Object.hasOwn(data, relationshipName)) {
        throw new TypeError(`Provide either "${fieldName}" or "${relationshipName}", not both.`);
      }
      if (data[fieldName] !== undefined) {
        data[relationshipName] = data[fieldName];
      }
      delete data[fieldName];
    }
    return data;
  }

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
          format: "jsonapi"
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
            format: "jsonapi"
          },
          createJsonRestContext(options.context || null)
        )
      )
    );
  }

  async function createDocument(payload = {}, options = {}) {
    return requireApiResource().post(
      {
        data: inputData(payload),
        returning: "full",
        transaction: options.trx || null,
        format: "jsonapi"
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
          data: inputData(sourcePatch),
          returning: "full",
          transaction: options.trx || null,
          format: "jsonapi"
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
          returning: "none",
          transaction: options.trx || null,
          format: "jsonapi"
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
