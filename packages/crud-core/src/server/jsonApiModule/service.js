import { returnJsonApiDocument } from "@jskit-ai/http-runtime/shared";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { buildJsonRestQueryParams } from "@jskit-ai/resource-runtime/server/resourceHost";

// The record timestamps a CRUD write stamps, as the earlier CRUD runtime did, when the table stores them.
const CREATE_STAMPS = Object.freeze(["createdAt", "updatedAt"]);
const PATCH_STAMPS = Object.freeze(["updatedAt"]);

/**
 * The fields among `names` the table stores as date-times (not computed in the query).
 * @param {Record<string, any>} schema The table resource's schema.
 * @param {readonly string[]} names
 */
function storedDateTimeFields(schema, names) {
  return names.filter((name) => {
    const field = schema[name];
    return field?.type === "dateTime" && field.virtual !== true && field.storage?.virtual !== true && !field.storage?.queryProjection;
  });
}

/** @param {readonly string[]} fields */
function stamps(fields) {
  const now = new Date().toISOString();
  return Object.fromEntries(fields.map((field) => [field, now]));
}

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
 * The CRUD service: the HTTP edge of a CRUD feature. It takes an operation's
 * HTTP query and body, calls the feature's repository (its table's handle, as
 * decorated) with the call's options and `format: "jsonapi"`, and answers
 * JSON:API documents. Server code calls the repository instead.
 * A create stamps the table's createdAt and updatedAt, unless the payload
 * sets them, and a patch stamps its updatedAt, when the table stores them as
 * date-times.
 * @param {object} dependencies
 * @param {import("../types.js").CrudRepository} dependencies.repository
 * @param {string} dependencies.resourceName The CRUD contract's table resource name, the type of its documents.
 * @param {Record<string, any>} [dependencies.schema] The table resource's schema, which says what to stamp.
 */
function createCrudService({ repository, resourceName, schema = {} }) {
  const createStamps = storedDateTimeFields(schema, CREATE_STAMPS);
  const patchStamps = storedDateTimeFields(schema, PATCH_STAMPS);

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
    return returnJsonApiDocument(await repository.query(buildJsonRestQueryParams(resourceName, query), documentOptions(options)));
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
    return returnJsonApiDocument(requireDocument(
      await repository.get(recordId, buildJsonRestQueryParams(resourceName, query), { ...documentOptions(options), missing: "skip" })
    ));
  }

  /**
   * @param {Record<string, unknown>} payload
   * @param {{ context?: object | null, trx?: object | null }} options
   */
  async function create(payload, options) {
    return returnJsonApiDocument(await repository.create({ ...stamps(createStamps), ...payload }, documentOptions(options)));
  }

  /**
   * @param {unknown} recordId
   * @param {Record<string, unknown>} payload
   * @param {{ context?: object | null, trx?: object | null }} options
   */
  async function patch(recordId, payload, options) {
    try {
      return returnJsonApiDocument(requireDocument(
        await repository.patch(recordId, { ...payload, ...stamps(patchStamps) }, documentOptions(options))
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
