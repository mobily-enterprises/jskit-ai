import { consoleSettingsSchema as consoleSettingsResourceSchema } from "../../shared/contracts/resources/consoleSettingsSchema.js";

const consoleSettingsRoutes = Object.freeze({
  body: {
    update: consoleSettingsResourceSchema.operations.replace.body.schema
  },
  response: {
    settings: consoleSettingsResourceSchema.operations.view.response.schema
  },
  resources: {
    consoleSettings: consoleSettingsResourceSchema
  },
  commands: {}
});

export { consoleSettingsRoutes };
