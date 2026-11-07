import { returnJsonApiDocument } from "@jskit-ai/http-runtime/shared";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { buildJsonRestQueryParams } from "@jskit-ai/resource-runtime/server";
import { resolveDeclaredLookupContainerKey, resolveSchemaFieldDefinitions } from "../jsonApiResourceContract.js";

// A record that is missing or out of the caller's scope.
function documentNotFound() {
  return new AppError(404, "Document not found.", { code: "crud.document.notFound" });
}

function requireDocument(document) {
  if (!document) {
    throw documentNotFound();
  }
  return document;
}

// json-rest-api's not-found error, classified by its code.
function isNotFound(error) {
  return error?.code === "REST_API_RESOURCE" && error?.subtype === "not_found";
}

/**
 * The attributes a contract's records carry: the fields of its record output, or of a list-only contract's list item.
 * @param {import("../types.js").CrudContract} crud
 */
function shownAttributes(crud) {
  const record = ["view", "create", "replace", "patch"].map((name) => crud.operations[name]?.output).find(Boolean);
  const fields = resolveSchemaFieldDefinitions(record || { schema: resolveSchemaFieldDefinitions(crud.operations.list?.output).items?.items });
  const lookupContainerKey = resolveDeclaredLookupContainerKey(crud);
  return new Set(Object.keys(fields).filter((key) => key !== lookupContainerKey));
}

/**
 * The CRUD service: the HTTP edge of a CRUD feature. It takes an operation's
 * HTTP query and body, calls the feature's repository (its table's handle, as
 * decorated) with the call's options and `format: "jsonapi"`, and answers
 * JSON:API documents whose records carry only the attributes the CRUD
 * contract's output names, so a column it does not name is never answered.
 * Server code calls the repository instead. The handle stamps the table's
 * createdAt and updatedAt, as it does for every write.
 * @param {object} dependencies
 * @param {import("../types.js").CrudRepository} dependencies.repository
 * @param {import("../types.js").CrudContract} dependencies.crud The CRUD contract the service answers for.
 */
function createCrudService({ repository, crud }) {
  const resourceName = crud.resource.name;
  const shown = shownAttributes(crud);

  /** @param {Record<string, any>} record A JSON:API resource object of the contract's table. */
  function shownRecord(record) {
    if (!record?.attributes) {
      return record;
    }
    return { ...record, attributes: Object.fromEntries(Object.entries(record.attributes).filter(([key]) => shown.has(key))) };
  }

  /** @param {Record<string, any> | null} document */
  function answer(document) {
    if (!document?.data) {
      return returnJsonApiDocument(document);
    }
    const data = Array.isArray(document.data) ? document.data.map(shownRecord) : shownRecord(document.data);
    return returnJsonApiDocument({ ...document, data });
  }

  /** @param {{ context?: object | null, trx?: object | null }} options */
  function documentOptions(options) {
    return { ...options, format: "jsonapi" };
  }

  /**
   * One page of the records the HTTP query matches: its filters, `include`,
   * `fields`, `sort`, `limit` and `cursor`.
   * @param {Record<string, unknown>} query
   * @param {{ context?: object | null, trx?: object | null }} options
   */
  async function list(query, options) {
    return answer(await repository.query(buildJsonRestQueryParams(resourceName, query), documentOptions(options)));
  }

  /**
   * @param {unknown} recordId
   * @param {Record<string, unknown>} query `include` and `fields`.
   * @param {{ context?: object | null, trx?: object | null }} options
   */
  async function view(recordId, query, options) {
    if (options && Object.hasOwn(options, "forUpdate")) {
      throw new TypeError(
        "The CRUD service's view() no longer takes forUpdate: lock the record with the repository's " +
        "lock(recordId, txOptions) inside repository.withTransaction(options, (txOptions) => ...)."
      );
    }
    return answer(requireDocument(
      await repository.get(recordId, buildJsonRestQueryParams(resourceName, query), { ...documentOptions(options), missing: "skip" })
    ));
  }

  /**
   * @param {Record<string, unknown>} payload
   * @param {{ context?: object | null, trx?: object | null }} options
   */
  async function create(payload, options) {
    return answer(await repository.create(payload, documentOptions(options)));
  }

  /**
   * @param {unknown} recordId
   * @param {Record<string, unknown>} payload
   * @param {{ context?: object | null, trx?: object | null }} options
   */
  async function patch(recordId, payload, options) {
    try {
      return answer(requireDocument(
        await repository.patch(recordId, payload, documentOptions(options))
      ));
    } catch (error) {
      throw isNotFound(error) ? documentNotFound() : error;
    }
  }

  /**
   * Deletes the record and answers its id; a record that is already gone answers null.
   * @param {unknown} recordId
   * @param {{ context?: object | null, trx?: object | null }} options
   */
  async function deleteRecord(recordId, options) {
    return repository.delete(recordId, { ...options, missing: "skip" });
  }

  return Object.freeze({
    list,
    view,
    create,
    patch,
    delete: deleteRecord
  });
}

export { createCrudService };
