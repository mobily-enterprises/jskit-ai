import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

function return404IfNotFound(record = null) {
  if (!record) {
    throw new AppError(404, "Record not found.");
  }
  return record;
}

function createService({ usersRepository } = {}) {
  if (!usersRepository) {
    throw new TypeError("createService requires usersRepository.");
  }

  return Object.freeze({
    listRecords(query = {}, options = {}) {
      return usersRepository.list(query, {
        trx: options?.trx || null,
        context: options?.context || null
      });
    },
    async getRecord(recordId, options = {}) {
      return return404IfNotFound(await usersRepository.findById(recordId, {
        trx: options?.trx || null,
        context: options?.context || null,
        include: options?.include
      }));
    }
  });
}

export { createService };
