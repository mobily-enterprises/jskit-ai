import {
  buildJsonRestQueryParams,
  createJsonRestContext,
  queryAllJsonRestCollectionDocument,
  returnBadRequestWhenJsonRestFieldsetInvalid,
  returnNullWhenJsonRestResourceMissing
} from "@jskit-ai/resource-runtime/server/resourceHost";
import { resolveTransaction, retryDeadlocks } from "@jskit-ai/database-runtime/shared";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

/** @typedef {"full" | "minimal" | "none"} WriteReturning */

const WRITE_RETURNING = new Set(["full", "minimal", "none"]);

/**
 * @param {{ returning?: unknown }} options
 * @param {WriteReturning} [fallback]
 * @returns {WriteReturning}
 */
function writeReturning(options, fallback = "full") {
  const returning = options.returning ?? fallback;
  if (!WRITE_RETURNING.has(returning)) {
    throw new TypeError(`returning must be "full", "minimal" or "none". Received: ${JSON.stringify(returning)}`);
  }
  return /** @type {WriteReturning} */ (returning);
}

/**
 * @param {object} dependencies
 * @param {import("@jskit-ai/resource-runtime/server/types").RuntimeJsonRestApi} dependencies.api
 * @param {import("../types.js").TableResource} dependencies.resource The table resource.
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

  /** The largest `limit` queryDocuments accepts: the resource's json-rest-api `queryMaxLimit`. */
  function queryMaxLimit() {
    return requireApiResource().vars.queryMaxLimit;
  }

  /**
   * One page of the records the query matches: `limit` records (the
   * resource's default page without one) after `cursor`, with
   * `meta.pagination` reporting `hasMore` and the next cursor. A `limit`
   * above queryMaxLimit() throws a TypeError naming queryEveryDocument,
   * because json-rest-api would answer only queryMaxLimit() records.
   * @param {Record<string, unknown>} [query]
   * @param {{ trx?: any, context?: object | null }} [options]
   */
  async function queryDocuments(query = {}, options = {}) {
    if (query.limit != null && Number(query.limit) > queryMaxLimit()) {
      throw new TypeError(
        `${scopeName} queryDocuments limit ${query.limit} is above its queryMaxLimit (${queryMaxLimit()}), so it would ` +
          `return only ${queryMaxLimit()} records. Read every record with queryEveryDocument(query, options), or page with limit and cursor.`
      );
    }
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

  /**
   * Every record the query matches, as one JSON:API document `{ data,
   * included }`, for server code that needs them all. It takes
   * queryDocuments' filters, include and fields, but no limit, cursor or
   * sort: it reads 1,000-record pages in id order in the caller's transaction,
   * so no record is skipped or repeated. Sort the records it returns.
   * @param {Record<string, unknown>} [query]
   * @param {{ trx?: any, context?: object | null }} [options]
   */
  async function queryEveryDocument(query = {}, options = {}) {
    for (const key of ["limit", "cursor", "sort"]) {
      if (query[key] != null) {
        throw new TypeError(
          `${scopeName} queryEveryDocument reads every record in id order, so its query cannot name ${key}; sort the records it returns.`
        );
      }
    }
    return returnBadRequestWhenJsonRestFieldsetInvalid(() =>
      queryAllJsonRestCollectionDocument(
        requireApiResource(),
        {
          queryParams: buildJsonRestQueryParams(scopeName, query),
          transaction: resolveTransaction(options)
        },
        options.context
      )
    );
  }

  // Locks the record's row until trx ends, so another forUpdate read or a write
  // of it waits. SQLite runs one transaction at a time on knex's single
  // connection, so it has no row lock to take.
  async function lockRecord(recordId, trx) {
    if (/sqlite/.test(String(trx.client.config.client))) {
      return;
    }
    const storage = api.knex.helpers.getStorageAdapter(scopeName);
    await storage.buildBaseQuery({ transaction: trx })
      .where(storage.getIdColumn(), storage.translateFilterValue("id", recordId))
      .forUpdate()
      .first(storage.getIdColumn());
  }

  /**
   * One record as a JSON:API document, or null when it is missing or hidden.
   * `options.forUpdate: true` first locks its row in `options.trx` (required)
   * until that transaction ends, so a concurrent forUpdate read or write of it
   * waits: read, check and write inside one transaction without a lost update.
   * The lock comes before the read, so on PostgreSQL (READ COMMITTED) the read
   * sees the latest version; on MySQL's REPEATABLE READ it does when the lock
   * is the transaction's first read.
   * @param {unknown} recordId
   * @param {Record<string, unknown>} [query]
   * @param {{ trx?: any, context?: object | null, forUpdate?: boolean }} [options]
   */
  async function getDocumentById(recordId, query = {}, options = {}) {
    if (options.forUpdate != null && typeof options.forUpdate !== "boolean") {
      throw new TypeError(`${scopeName} getDocumentById forUpdate must be true or false. Received: ${options.forUpdate}`);
    }
    if (options.forUpdate) {
      const trx = resolveTransaction(options);
      if (!trx) {
        throw new TypeError(
          `${scopeName} getDocumentById forUpdate locks the record until its transaction ends, so it needs options.trx ` +
            "(run it inside withTransaction)."
        );
      }
      await lockRecord(recordId, trx);
    }
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

  function post(payload, returning, options) {
    return requireApiResource().post(
      {
        data: inputData(payload),
        returning,
        transaction: resolveTransaction(options),
        format: "jsonapi"
      },
      createJsonRestContext(options.context)
    );
  }

  /**
   * Creates one record. `options.returning` picks the result: "full" (the
   * default) reads the new record back through its row policy and lookups;
   * "minimal" answers `{ data: { type, id } }` and "none" undefined, without
   * that read.
   * @param {Record<string, unknown>} [payload]
   * @param {{ trx?: any, context?: object | null, returning?: WriteReturning }} [options]
   */
  async function createDocument(payload = {}, options = {}) {
    const returning = writeReturning(options);
    return write(options, () => post(payload, returning, options));
  }

  /**
   * Creates every payload, in order, in one transaction: the caller's `trx`,
   * or one it owns and retries whole on a deadlock, so either all are created
   * or none. Results follow the payloads' order; `options.returning` is
   * "minimal" by default, so no record is read back.
   * @param {Record<string, unknown>[]} payloads
   * @param {{ trx?: any, context?: object | null, returning?: WriteReturning }} [options]
   */
  async function createDocuments(payloads, options = {}) {
    if (!Array.isArray(payloads)) {
      throw new TypeError("createDocuments requires an array of payloads.");
    }
    const returning = writeReturning(options, "minimal");
    async function createAll(trx) {
      const results = [];
      for (const payload of payloads) {
        results.push(await post(payload, returning, { ...options, trx }));
      }
      return results;
    }
    const trx = resolveTransaction(options);
    return trx ? createAll(trx) : withTransaction(createAll);
  }

  /**
   * Patches one record; null when it does not exist or is out of the
   * caller's scope. `options.returning` picks the result as createDocument's.
   * @param {string | number} recordId
   * @param {Record<string, unknown>} patch
   * @param {{ trx?: any, context?: object | null, returning?: WriteReturning }} [options]
   */
  async function patchDocumentById(recordId, patch, options = {}) {
    const returning = writeReturning(options);
    if (Object.keys(patch).length < 1) {
      const document = await getDocumentById(recordId, {}, options);
      if (!document || returning === "full") {
        return document;
      }
      return returning === "minimal" ? { data: { type: scopeName, id: document.data.id } } : undefined;
    }

    return returnNullWhenJsonRestResourceMissing(() => write(options, () =>
      requireApiResource().patch(
        {
          id: recordId,
          data: inputData(patch),
          returning,
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
    queryMaxLimit,
    queryDocuments,
    queryEveryDocument,
    getDocumentById,
    createDocument,
    createDocuments,
    patchDocumentById,
    patchDocumentIfLockVersion,
    deleteDocumentById
  });
}

export { createCrudJsonApiRepository };
