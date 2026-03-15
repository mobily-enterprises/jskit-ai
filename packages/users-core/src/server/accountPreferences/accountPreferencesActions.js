import {
  resolveRequest,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";

const accountPreferencesActions = Object.freeze([
  {
    id: "settings.preferences.update",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    consoleUsersOnly: false,
    inputValidator: userSettingsResource.operations.preferencesUpdate.bodyValidator,
    outputValidator: userSettingsResource.operations.view.outputValidator,
    idempotency: "optional",
    audit: {
      actionName: "settings.preferences.update"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountPreferencesService.updatePreferences(
        resolveRequest(context),
        resolveUser(context, input),
        input,
        {
          context
        }
      );
    }
  }
]);

export { accountPreferencesActions };
