import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { userSettingsResource } from "../../../shared/resources/userSettingsResource.js";

const settingsResponseValidator = Object.freeze({
  schema: userSettingsResource.operations.view.response.schema,
  normalize: normalizeObjectInput
});

export { settingsResponseValidator };
