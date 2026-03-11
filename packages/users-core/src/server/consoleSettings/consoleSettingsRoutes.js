import { consoleSettingsResource } from "../../shared/contracts/resources/consoleSettingsResource.js";

const consoleSettingsRoutes = Object.freeze({
  body: {
    update: consoleSettingsResource.operations.replace.body.schema
  },
  response: {
    settings: consoleSettingsResource.operations.view.response.schema
  },
  resources: {
    consoleSettings: consoleSettingsResource
  },
  commands: {}
});

export { consoleSettingsRoutes };
