import {
  resolveRequest
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";
import { resolveActionUser } from "../common/support/resolveActionUser.js";

const accountPreferencesActions = Object.freeze([
  {
    id: "settings.preferences.update",
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "enabled",
    permission: {
      require: "authenticated"
    },
    input: userSettingsResource.operations.preferencesUpdate.body,
    output: userSettingsResource.operations.view.output,
    idempotency: "optional",
    audit: {
      actionName: "settings.preferences.update"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountPreferencesService.updatePreferences(
        resolveRequest(context),
        resolveActionUser(context, input),
        input,
        {
          context
        }
      );
    }
  }
]);

export { accountPreferencesActions };
