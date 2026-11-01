import { returnJsonApiDocument } from "@jskit-ai/http-runtime/shared";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

function requireDocument(document = null) {
  if (!document) {
    throw new AppError(404, "Document not found.", { code: "crud.document.notFound" });
  }
  return document;
}

/** @param {{ repository: import("../types.js").CrudRepository }} dependencies */
function createCrudJsonApiService({ repository }) {
  async function queryDocuments(query = {}, options = {}) {
    return returnJsonApiDocument(await repository.queryDocuments(query, {
      trx: options.trx || null,
      context: options.context || null
    }));
  }

  async function getDocumentById(recordId, query = {}, options = {}) {
    return returnJsonApiDocument(requireDocument(await repository.getDocumentById(recordId, query, {
      trx: options.trx || null,
      context: options.context || null
    })));
  }

  async function createDocument(payload = {}, options = {}) {
    return returnJsonApiDocument(await repository.createDocument(payload, {
      trx: options.trx || null,
      context: options.context || null
    }));
  }

  async function patchDocumentById(recordId, payload = {}, options = {}) {
    return returnJsonApiDocument(requireDocument(await repository.patchDocumentById(recordId, payload, {
      trx: options.trx || null,
      context: options.context || null
    })));
  }

  async function deleteDocumentById(recordId, options = {}) {
    return repository.deleteDocumentById(recordId, {
      trx: options.trx || null,
      context: options.context || null
    });
  }

  return Object.freeze({
    queryDocuments,
    getDocumentById,
    createDocument,
    patchDocumentById,
    deleteDocumentById
  });
}

export { createCrudJsonApiService };
