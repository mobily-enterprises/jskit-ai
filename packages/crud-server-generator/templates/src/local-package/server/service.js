import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { returnJsonApiDocument } from "@jskit-ai/http-runtime/shared";

function return404IfNotFound(document = null) {
  if (!document) {
    throw new AppError(404, "Document not found.");
  }
  return document;
}

function createService({ ${option:namespace|camel}Repository } = {}) {
  if (!${option:namespace|camel}Repository) {
    throw new TypeError("createService requires ${option:namespace|camel}Repository.");
  }

  async function queryDocuments(query = {}, options = {}) {
    return returnJsonApiDocument(await ${option:namespace|camel}Repository.queryDocuments(query, {
      trx: options?.trx || null,
      context: options?.context || null
    }));
  }

  async function getDocumentById(recordId, options = {}) {
    return returnJsonApiDocument(return404IfNotFound(await ${option:namespace|camel}Repository.getDocumentById(recordId, {
      trx: options?.trx || null,
      context: options?.context || null,
      include: options?.include
    })));
  }

  async function createDocument(payload = {}, options = {}) {
    return returnJsonApiDocument(await ${option:namespace|camel}Repository.createDocument(payload, {
      trx: options?.trx || null,
      context: options?.context || null
    }));
  }

  async function patchDocumentById(recordId, payload = {}, options = {}) {
    return returnJsonApiDocument(return404IfNotFound(await ${option:namespace|camel}Repository.patchDocumentById(recordId, payload, {
      trx: options?.trx || null,
      context: options?.context || null
    })));
  }

  async function deleteDocumentById(recordId, options = {}) {
    return ${option:namespace|camel}Repository.deleteDocumentById(recordId, {
      trx: options?.trx || null,
      context: options?.context || null
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

export { createService };
