import { consoleSettingsSchema as consoleSettingsResourceSchema } from "@jskit-ai/users-core/shared/contracts/resources/consoleSettingsSchema";

const consoleSettingsRoutesContract = Object.freeze({
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

export { consoleSettingsRoutesContract };
