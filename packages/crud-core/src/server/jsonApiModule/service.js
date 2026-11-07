import { returnJsonApiDocument } from "@jskit-ai/http-runtime/shared";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { buildJsonRestQueryParams } from "@jskit-ai/resource-runtime/server/resourceHost";

function requireDocument(document) {
  if (!document) {
    throw new AppError(404, "Document not found.", { code: "crud.document.notFound" });
  }
  return document;
}

/**
 * The CRUD service: the HTTP edge of a CRUD feature. It takes an operation's
 * HTTP query and body, calls the feature's repository (its table's handle, as
 * decorated) with the call's options and `format: "jsonapi"`, and answers
 * JSON:API documents. Server code calls the repository instead.
 * @param {object} dependencies
 * @param {import("../types.js").CrudRepository} dependencies.repository
 * @param {string} dependencies.resourceName The CRUD contract's table resource name, the type of its documents.
 */
function createCrudService({ repository, resourceName }) {
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
    return returnJsonApiDocument(requireDocument(
      await repository.get(recordId, buildJsonRestQueryParams(resourceName, query), documentOptions(options))
    ));
  }

  /**
   * @param {Record<string, unknown>} payload
   * @param {{ context?: object | null, trx?: object | null }} options
   */
  async function create(payload, options) {
    return returnJsonApiDocument(await repository.create(payload, documentOptions(options)));
  }

  /**
   * @param {unknown} recordId
   * @param {Record<string, unknown>} payload
   * @param {{ context?: object | null, trx?: object | null }} options
   */
  async function patch(recordId, payload, options) {
    return returnJsonApiDocument(requireDocument(await repository.patch(recordId, payload, documentOptions(options))));
  }

  /**
   * @param {unknown} recordId
   * @param {{ context?: object | null, trx?: object | null }} options
   */
  async function deleteRecord(recordId, options) {
    return repository.delete(recordId, options);
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
