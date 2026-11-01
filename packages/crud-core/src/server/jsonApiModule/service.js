import { returnJsonApiDocument } from "@jskit-ai/http-runtime/shared";
import { resolveTransaction } from "@jskit-ai/database-runtime/shared";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

function requireDocument(document = null) {
  if (!document) {
    throw new AppError(404, "Document not found.", { code: "crud.document.notFound" });
  }
  return document;
}

/**
 * What a service call hands its repository: the call's transaction and action
 * context, each null when the call has none.
 * @param {{ trx?: import("@jskit-ai/database-runtime/server/types").RuntimeKnexTransaction | null, context?: object | null }} [options]
 */
function repositoryCallOptions(options = {}) {
  return { trx: resolveTransaction(options), context: options.context || null };
}

/** @param {{ repository: import("../types.js").CrudRepository }} dependencies */
function createCrudJsonApiService({ repository }) {
  async function queryDocuments(query = {}, options = {}) {
    return returnJsonApiDocument(await repository.queryDocuments(query, repositoryCallOptions(options)));
  }

  async function getDocumentById(recordId, query = {}, options = {}) {
    return returnJsonApiDocument(requireDocument(await repository.getDocumentById(recordId, query, repositoryCallOptions(options))));
  }

  async function createDocument(payload = {}, options = {}) {
    return returnJsonApiDocument(await repository.createDocument(payload, repositoryCallOptions(options)));
  }

  async function patchDocumentById(recordId, payload = {}, options = {}) {
    return returnJsonApiDocument(requireDocument(await repository.patchDocumentById(recordId, payload, repositoryCallOptions(options))));
  }

  async function deleteDocumentById(recordId, options = {}) {
    return repository.deleteDocumentById(recordId, repositoryCallOptions(options));
  }

  return Object.freeze({
    queryDocuments,
    getDocumentById,
    createDocument,
    patchDocumentById,
    deleteDocumentById
  });
}

export { createCrudJsonApiService, repositoryCallOptions };
