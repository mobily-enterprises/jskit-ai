import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { returnJsonApiDocument } from "@jskit-ai/http-runtime/shared";

function return404IfNotFound(document = null) {
  if (!document) {
    throw new AppError(404, "Document not found.");
  }
  return document;
}

function createService({ usersRepository } = {}) {
  if (!usersRepository) {
    throw new TypeError("createService requires usersRepository.");
  }

  return Object.freeze({
    async queryDocuments(query = {}, options = {}) {
      return returnJsonApiDocument(await usersRepository.queryDocuments(query, {
        trx: options?.trx || null,
        context: options?.context || null
      }));
    },
    async getDocumentById(recordId, options = {}) {
      return returnJsonApiDocument(return404IfNotFound(await usersRepository.getDocumentById(recordId, {
        trx: options?.trx || null,
        context: options?.context || null,
        include: options?.include
      })));
    }
  });
}

export { createService };
