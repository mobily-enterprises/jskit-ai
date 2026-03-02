import {
  createService as createCommunicationsCoreService,
  __testables as communicationsCoreTestables
} from "@jskit-ai/communications-core/server";

function createService(options = {}) {
  return createCommunicationsCoreService(options || {});
}

const __testables = communicationsCoreTestables;

export { createService, __testables };
