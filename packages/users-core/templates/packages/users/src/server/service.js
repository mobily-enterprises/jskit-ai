import {
  createCrudServiceRuntime,
  crudServiceListRecords,
  crudServiceGetRecord
} from "@jskit-ai/crud-core/server/serviceMethods";
import { resource } from "../shared/userResource.js";

const serviceRuntime = createCrudServiceRuntime(resource, {
  context: "usersService"
});
const serviceEvents = Object.freeze({});

function createService({ usersRepository } = {}) {
  if (!usersRepository) {
    throw new TypeError("createService requires usersRepository.");
  }

  return Object.freeze({
    listRecords(query = {}, options = {}) {
      return crudServiceListRecords(serviceRuntime, usersRepository, {}, query, options);
    },
    getRecord(recordId, options = {}) {
      return crudServiceGetRecord(serviceRuntime, usersRepository, {}, recordId, options);
    }
  });
}

export { createService, serviceEvents };
