import { returnJsonApiDocument } from "@jskit-ai/http-runtime/shared";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

function requireDocument(document = null) {
  if (!document) {
    throw new AppError(404, "Document not found.");
  }
  return document;
}

function createCrudJsonApiService({ repository } = {}) {
  if (!repository) {
    throw new TypeError("createCrudJsonApiService requires repository.");
  }

  return Object.freeze({
    async queryDocuments(query = {}, options = {}) {
      return returnJsonApiDocument(await repository.queryDocuments(query, {
        trx: options.trx || null,
        context: options.context || null
      }));
    },
    async getDocumentById(recordId, query = {}, options = {}) {
      return returnJsonApiDocument(requireDocument(await repository.getDocumentById(recordId, query, {
        trx: options.trx || null,
        context: options.context || null
      })));
    },
    async createDocument(payload = {}, options = {}) {
      return returnJsonApiDocument(await repository.createDocument(payload, {
        trx: options.trx || null,
        context: options.context || null
      }));
    },
    async patchDocumentById(recordId, payload = {}, options = {}) {
      return returnJsonApiDocument(requireDocument(await repository.patchDocumentById(recordId, payload, {
        trx: options.trx || null,
        context: options.context || null
      })));
    },
    async deleteDocumentById(recordId, options = {}) {
      return repository.deleteDocumentById(recordId, {
        trx: options.trx || null,
        context: options.context || null
      });
    }
  });
}

export { createCrudJsonApiService };
