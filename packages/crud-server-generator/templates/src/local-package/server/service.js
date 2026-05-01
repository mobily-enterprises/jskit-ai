import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

function return404IfNotFound(record = null) {
  if (!record) {
    throw new AppError(404, "Record not found.");
  }
  return record;
}

function createService({ ${option:namespace|camel}Repository } = {}) {
  async function listRecords(query = {}, options = {}) {
    return ${option:namespace|camel}Repository.list(query, {
      trx: options?.trx || null,
      context: options?.context || null
    });
  }

  async function getRecord(recordId, options = {}) {
    return return404IfNotFound(await ${option:namespace|camel}Repository.findById(recordId, {
      trx: options?.trx || null,
      context: options?.context || null,
      include: options?.include
    }));
  }

  async function createRecord(payload = {}, options = {}) {
    return ${option:namespace|camel}Repository.create(payload, {
      trx: options?.trx || null,
      context: options?.context || null
    });
  }

  async function updateRecord(recordId, payload = {}, options = {}) {
    return return404IfNotFound(await ${option:namespace|camel}Repository.updateById(recordId, payload, {
      trx: options?.trx || null,
      context: options?.context || null
    }));
  }

  async function deleteRecord(recordId, options = {}) {
    return ${option:namespace|camel}Repository.deleteById(recordId, {
      trx: options?.trx || null,
      context: options?.context || null
    });
  }

  return Object.freeze({
    listRecords,
    getRecord,
    createRecord,
    updateRecord,
    deleteRecord
  });
}

export { createService };
