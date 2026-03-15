import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import {
  createAuthorizedService,
  createEntityChangePublisher
} from "@jskit-ai/kernel/server/runtime";

function createService({ crudRepository, domainEvents } = {}) {
  if (!crudRepository || !domainEvents || typeof domainEvents.publish !== "function") {
    throw new Error("crudService requires crudRepository and domainEvents.publish().");
  }

  const publishRecordChange = createEntityChangePublisher({
    domainEvents,
    source: "crud",
    entity: "record"
  });

  const servicePermissions = Object.freeze({
    listRecords: Object.freeze({
      require: "authenticated"
    }),
    getRecord: Object.freeze({
      require: "authenticated"
    }),
    createRecord: Object.freeze({
      require: "authenticated"
    }),
    updateRecord: Object.freeze({
      require: "authenticated"
    }),
    deleteRecord: Object.freeze({
      require: "authenticated"
    })
  });

  async function listRecords(query = {}, options = {}) {
    return crudRepository.list(query, options);
  }

  async function getRecord(recordId, options = {}) {
    const record = await crudRepository.findById(recordId, options);
    if (!record) {
      throw new AppError(404, "Record not found.");
    }

    return record;
  }

  async function createRecord(payload = {}, options = {}) {
    const record = await crudRepository.create(payload, options);
    if (!record) {
      throw new Error("crudService could not load the created record.");
    }

    await publishRecordChange("created", record.id, options);
    return record;
  }

  async function updateRecord(recordId, payload = {}, options = {}) {
    const record = await crudRepository.updateById(recordId, payload, options);
    if (!record) {
      throw new AppError(404, "Record not found.");
    }

    await publishRecordChange("updated", record.id, options);
    return record;
  }

  async function deleteRecord(recordId, options = {}) {
    const deleted = await crudRepository.deleteById(recordId, options);
    if (!deleted) {
      throw new AppError(404, "Record not found.");
    }

    await publishRecordChange("deleted", deleted.id, options);
    return deleted;
  }

  return createAuthorizedService(
    {
      listRecords,
      getRecord,
      createRecord,
      updateRecord,
      deleteRecord
    },
    servicePermissions
  );
}

export { createService };
