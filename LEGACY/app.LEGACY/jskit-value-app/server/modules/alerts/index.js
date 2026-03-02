import {
  insertAlert,
  listAlertsForUser,
  countAlertsForUser,
  countUnreadAlertsForUser,
  getLatestAlertIdForUser,
  getReadStateForUser,
  upsertReadStateForUser,
  transaction
} from "./repository.js";
import { createService as createAlertsService } from "./service.js";
import { createRepositoryExport } from "../moduleExports.js";

const repository = Object.freeze({
  insertAlert,
  listAlertsForUser,
  countAlertsForUser,
  countUnreadAlertsForUser,
  getLatestAlertIdForUser,
  getReadStateForUser,
  upsertReadStateForUser,
  transaction
});

function createService(options = {}) {
  const service = createAlertsService(options);
  return {
    service
  };
}

function createRepository() {
  return createRepositoryExport(repository);
}

export { createController } from "./controller.js";
export { buildRoutes } from "./routes.js";
export { schema } from "./schema.js";
export { createService, createRepository };
