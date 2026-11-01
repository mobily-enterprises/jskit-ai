import {
  buildJsonRestQueryParams,
  createJsonRestContext,
  returnBadRequestWhenJsonRestFieldsetInvalid,
  returnNullWhenJsonRestResourceMissing
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { resolveTransaction, retryDeadlocks } from "@jskit-ai/database-runtime/shared";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

/**
 * @param {object} dependencies
 * @param {import("@jskit-ai/json-rest-api-core/server/types").RuntimeJsonRestApi} dependencies.api
 * @param {import("../types.js").CrudResourceDefinition} dependencies.resource
 * @param {string} dependencies.resourceScopeName
 */
function createCrudJsonApiRepository({ api, resource, resourceScopeName }) {
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
    throw new TypeError("createCrudJsonApiRepository requires resource.");
  }
  const scopeName = String(resourceScopeName || "").trim();
  if (!scopeName) {
    throw new TypeError("createCrudJsonApiRepository requires resourceScopeName.");
  }

  function withTransaction(work) {
    return retryDeadlocks(() => api.transaction(work));
  }

  // A write given no transaction owns one, so it is outermost and may re-run.
  function write(options, run) {
    return resolveTransaction(options) ? run() : retryDeadlocks(run);
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
    const apiResource = api.resources[scopeName];
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
          transaction: resolveTransaction(options),
          format: "jsonapi"
        },
        createJsonRestContext(options.context)
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
            transaction: resolveTransaction(options),
            format: "jsonapi"
          },
          createJsonRestContext(options.context)
        )
      )
    );
  }

  async function createDocument(payload = {}, options = {}) {
    return write(options, () => requireApiResource().post(
      {
        data: inputData(payload),
        returning: "full",
        transaction: resolveTransaction(options),
        format: "jsonapi"
      },
      createJsonRestContext(options.context)
    ));
  }

  async function patchDocumentById(recordId, patch, options = {}) {
    if (Object.keys(patch).length < 1) {
      return getDocumentById(recordId, {}, options);
    }

    return returnNullWhenJsonRestResourceMissing(() => write(options, () =>
      requireApiResource().patch(
        {
          id: recordId,
          data: inputData(patch),
          returning: "full",
          transaction: resolveTransaction(options),
          format: "jsonapi"
        },
        createJsonRestContext(options.context)
      )
    ));
  }

  /**
   * Patches a record only while its lockVersionField still holds
   * expectedLockVersion, and adds one to it in the same transaction: the
   * caller's `trx`, or one it owns. Returns the patched document, or null when
   * the record does not exist or is out of the caller's scope; a record whose
   * lock version has moved on rejects with a 409 `crud.document.lockVersionConflict`.
   * @param {string | number} recordId
   * @param {number} expectedLockVersion
   * @param {Record<string, unknown>} patch
   * @param {{ trx?: any, context?: object }} [options]
   */
  async function patchDocumentIfLockVersion(recordId, expectedLockVersion, patch, options = {}) {
    const lockVersionField = resource.lockVersionField;
    if (!lockVersionField) {
      throw new TypeError(`patchDocumentIfLockVersion needs resource "${scopeName}" to name its lockVersionField.`);
    }
    if (!Number.isSafeInteger(expectedLockVersion) || expectedLockVersion < 0) {
      throw new TypeError(`patchDocumentIfLockVersion expectedLockVersion must be a non-negative integer. Received: ${expectedLockVersion}`);
    }
    if (Object.hasOwn(patch, lockVersionField)) {
      throw new TypeError(`patchDocumentIfLockVersion advances ${lockVersionField} itself, so the patch must leave it out.`);
    }

    async function patchAtLockVersion(trx) {
      const scoped = { ...options, trx };
      if (!await getDocumentById(recordId, {}, scoped)) {
        return null;
      }
      const storage = api.knex.helpers.getStorageAdapter(scopeName);
      const lockColumn = storage.translateColumn(lockVersionField);
      const claimed = await storage.buildBaseQuery({ transaction: trx })
        .where(storage.getIdColumn(), storage.translateFilterValue("id", recordId))
        .where(lockColumn, expectedLockVersion)
        .update({ [lockColumn]: expectedLockVersion + 1 });
      if (claimed < 1) {
        throw new AppError(409, "This record changed. Reload and try again.", {
          code: "crud.document.lockVersionConflict"
        });
      }
      return patchDocumentById(recordId, patch, scoped);
    }

    const trx = resolveTransaction(options);
    return trx
      ? patchAtLockVersion(trx)
      : returnNullWhenJsonRestResourceMissing(() => withTransaction(patchAtLockVersion));
  }

  async function deleteDocumentById(recordId, options = {}) {
    return returnNullWhenJsonRestResourceMissing(async () => {
      await write(options, () => requireApiResource().delete(
        {
          id: recordId,
          returning: "none",
          transaction: resolveTransaction(options),
          format: "jsonapi"
        },
        createJsonRestContext(options.context)
      ));
      return null;
    });
  }

  return Object.freeze({
    withTransaction,
    queryDocuments,
    getDocumentById,
    createDocument,
    patchDocumentById,
    patchDocumentIfLockVersion,
    deleteDocumentById
  });
}

export { createCrudJsonApiRepository };
