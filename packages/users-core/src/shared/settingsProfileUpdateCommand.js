import { Type } from "typebox";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { createOperationMessages } from "./contractUtils.js";
import { userSettingsResource } from "./resources/userSettingsResource.js";
import { userProfileResource } from "./resources/userProfileResource.js";

const settingsProfileUpdateOutputValidator = Object.freeze({
  schema: Type.Object(
    {
      settings: userSettingsResource.operations.view.output.schema,
      session: Type.Union([Type.Object({}, { additionalProperties: true }), Type.Null()])
    },
    { additionalProperties: false }
  ),
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);

    return {
      settings: userSettingsResource.operations.view.output.normalize(source.settings),
      session: source.session && typeof source.session === "object" ? source.session : null
    };
  }
});

const SETTINGS_PROFILE_UPDATE_MESSAGES = createOperationMessages();

const settingsProfileUpdateCommand = Object.freeze({
  command: "settings.profile.update",
  operation: Object.freeze({
    method: "PATCH",
    messages: SETTINGS_PROFILE_UPDATE_MESSAGES,
    body: userProfileResource.operations.patch.body,
    response: settingsProfileUpdateOutputValidator,
    idempotent: false,
    invalidates: Object.freeze(["settings.read"])
  })
});

export { settingsProfileUpdateCommand };
